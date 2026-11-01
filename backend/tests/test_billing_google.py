"""GoogleVerifier against Google's documented REST shapes, using a fake HTTP layer.

No real network call is made and no real credential is used: a throwaway RSA key is
generated per module and written to a tmp service-account file.
"""
import asyncio
import json
import logging
from datetime import datetime
from urllib.parse import parse_qs, quote

import httpx
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from jose import jwt

from app.services.billing.google import (
    ANDROID_PUBLISHER_SCOPE,
    TOKEN_URL,
    GoogleVerifier,
)
from app.services.billing.verifier import VerifierError

PACKAGE = "health.luna.example"
PRODUCTS = ["luna_ai_monthly", "luna_ai_yearly"]
CLIENT_EMAIL = "billing-test@example-project.iam.gserviceaccount.com"
# Characters that must be percent-encoded in a path segment, to prove encoding.
TOKEN = "secret-purchase-token.AO-J1Ox/abc+def=="
ACCOUNT = "b" * 64
BASE = "https://androidpublisher.googleapis.com/androidpublisher/v3/applications"
GET_URL = f"{BASE}/{PACKAGE}/purchases/subscriptionsv2/tokens/{quote(TOKEN, safe='')}"


def run(coro):
    return asyncio.run(coro)


@pytest.fixture(scope="module")
def keypair():
    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    private_pem = private.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode()
    public_pem = private.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    ).decode()
    return private_pem, public_pem


@pytest.fixture
def sa_file(tmp_path, keypair):
    path = tmp_path / "service-account.json"
    path.write_text(json.dumps({
        "type": "service_account",
        "client_email": CLIENT_EMAIL,
        "private_key_id": "throwaway-kid",
        "private_key": keypair[0],
    }))
    return str(path)


class FakeResponse:
    def __init__(self, status_code, body=None, text=None):
        self.status_code = status_code
        self._body = body
        self.text = text if text is not None else (json.dumps(body) if body is not None else "")

    def json(self):
        if self._body is None:
            return json.loads(self.text)  # raises for non-JSON text
        return self._body


class FakeHttp:
    """Records requests; answers the token endpoint itself and pops queued API responses."""

    def __init__(self, responses=(), token_response=None):
        self.calls = []
        self.responses = list(responses)
        self.token_response = token_response
        self.token_count = 0

    async def request(self, method, url, *, headers=None, data=None, json=None):
        self.calls.append({"method": method, "url": url, "headers": headers or {}, "data": data, "json": json})
        if url == TOKEN_URL:
            self.token_count += 1
            if self.token_response is not None:
                return self.token_response
            return FakeResponse(200, {"access_token": f"access-{self.token_count}", "expires_in": 3599, "token_type": "Bearer"})
        item = self.responses.pop(0)
        if isinstance(item, BaseException):
            raise item
        return item

    @property
    def api_calls(self):
        return [c for c in self.calls if c["url"] != TOKEN_URL]


class Clock:
    def __init__(self, t=1_800_000_000.0):
        self.t = t

    def __call__(self):
        return self.t


def make(sa_file, responses=(), clock=None, **kw):
    http = FakeHttp(responses, **kw)
    v = GoogleVerifier(
        http=http,
        now=clock or Clock(),
        package_name=PACKAGE,
        product_ids=PRODUCTS,
        service_account_file=sa_file,
    )
    return v, http


def sub(state="SUBSCRIPTION_STATE_ACTIVE", line_items=None, ack="ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED", account=ACCOUNT):
    body = {
        "kind": "androidpublisher#subscriptionPurchaseV2",
        "regionCode": "US",
        "startTime": "2026-11-01T10:00:00.123Z",
        "subscriptionState": state,
        "latestOrderId": "GPA.0000-0000-0000-00000",
        "lineItems": line_items if line_items is not None else [
            {
                "productId": "luna_ai_monthly",
                "expiryTime": "2026-12-01T10:00:00.123456789Z",
                "autoRenewingPlan": {"autoRenewEnabled": True},
            }
        ],
    }
    if ack is not None:
        body["acknowledgementState"] = ack
    if account is not None:
        body["externalAccountIdentifiers"] = {"obfuscatedExternalAccountId": account}
    return body


# --- service-account access token -------------------------------------------------


def test_get_request_shape_and_jwt_assertion(sa_file, keypair):
    clock = Clock()
    v, http = make(sa_file, [FakeResponse(200, sub())], clock=clock)
    run(v.get(TOKEN))

    token_call, api_call = http.calls
    assert token_call["method"] == "POST" and token_call["url"] == TOKEN_URL
    form = token_call["data"]
    assert form["grant_type"] == "urn:ietf:params:oauth:grant-type:jwt-bearer"
    assert jwt.get_unverified_header(form["assertion"])["alg"] == "RS256"
    claims = jwt.decode(
        form["assertion"], keypair[1], algorithms=["RS256"], audience="https://oauth2.googleapis.com/token"
    )
    assert claims["iss"] == CLIENT_EMAIL
    assert claims["scope"] == ANDROID_PUBLISHER_SCOPE == "https://www.googleapis.com/auth/androidpublisher"
    assert claims["aud"] == TOKEN_URL == "https://oauth2.googleapis.com/token"
    assert claims["iat"] == int(clock.t)
    assert 0 < claims["exp"] - claims["iat"] <= 3600

    assert api_call["method"] == "GET"
    assert api_call["url"] == GET_URL
    assert TOKEN not in api_call["url"]  # only the percent-encoded form
    assert api_call["headers"]["Authorization"] == "Bearer access-1"


def test_assertion_signature_fails_with_other_key(sa_file):
    v, http = make(sa_file, [FakeResponse(200, sub())])
    run(v.get(TOKEN))
    other = rsa.generate_private_key(public_exponent=65537, key_size=2048).public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    ).decode()
    with pytest.raises(Exception):
        jwt.decode(http.calls[0]["data"]["assertion"], other, algorithms=["RS256"], audience=TOKEN_URL)


def test_access_token_is_cached_and_refreshed_near_expiry(sa_file):
    clock = Clock()
    v, http = make(sa_file, [FakeResponse(200, sub()) for _ in range(4)], clock=clock)
    run(v.get(TOKEN))
    clock.t += 3599 - 61  # still more than 60 s left
    run(v.get(TOKEN))
    assert http.token_count == 1
    assert http.api_calls[1]["headers"]["Authorization"] == "Bearer access-1"
    clock.t += 1  # now exactly 60 s before expiry -> refresh
    run(v.get(TOKEN))
    assert http.token_count == 2
    assert http.api_calls[2]["headers"]["Authorization"] == "Bearer access-2"
    run(v.get(TOKEN))
    assert http.token_count == 2


def test_api_401_drops_cached_access_token(sa_file):
    v, http = make(sa_file, [FakeResponse(401, {"error": {"code": 401}}), FakeResponse(200, sub())])
    with pytest.raises(VerifierError) as exc:
        run(v.get(TOKEN))
    assert exc.value.kind == "network"
    run(v.get(TOKEN))
    assert http.token_count == 2


@pytest.mark.parametrize(
    "response",
    [
        FakeResponse(400, {"error": "invalid_grant"}),
        FakeResponse(500, text="oops"),
        FakeResponse(200, {"token_type": "Bearer"}),  # no access_token
        FakeResponse(200, text="<html>"),
    ],
)
def test_token_endpoint_failures_are_network(sa_file, response):
    v, http = make(sa_file, [], token_response=response)
    with pytest.raises(VerifierError) as exc:
        run(v.get(TOKEN))
    assert exc.value.kind == "network"
    assert http.api_calls == []


def test_token_endpoint_timeout_is_network(sa_file):
    class TimeoutHttp(FakeHttp):
        async def request(self, method, url, **kw):
            raise httpx.ConnectTimeout("timed out")

    v = GoogleVerifier(http=TimeoutHttp(), package_name=PACKAGE, product_ids=PRODUCTS, service_account_file=sa_file)
    with pytest.raises(VerifierError) as exc:
        run(v.get(TOKEN))
    assert exc.value.kind == "network"


@pytest.mark.parametrize("content", ["not json", json.dumps({"client_email": CLIENT_EMAIL})])
def test_unusable_service_account_file_is_network(tmp_path, content):
    path = tmp_path / "sa.json"
    path.write_text(content)
    v, http = make(str(path), [FakeResponse(200, sub())])
    with pytest.raises(VerifierError) as exc:
        run(v.get(TOKEN))
    assert exc.value.kind == "network"
    assert http.calls == []


# --- response mapping -------------------------------------------------------------


@pytest.mark.parametrize(
    "state",
    [
        "SUBSCRIPTION_STATE_ACTIVE",
        "SUBSCRIPTION_STATE_IN_GRACE_PERIOD",
        "SUBSCRIPTION_STATE_CANCELED",
        "SUBSCRIPTION_STATE_ON_HOLD",
        "SUBSCRIPTION_STATE_PAUSED",
        "SUBSCRIPTION_STATE_EXPIRED",
        "SUBSCRIPTION_STATE_PENDING",
    ],
)
def test_maps_each_state(sa_file, state):
    v, _ = make(sa_file, [FakeResponse(200, sub(state=state))])
    info = run(v.get(TOKEN))
    assert info.state == state
    assert info.product_id == "luna_ai_monthly"
    assert info.expiry_time == datetime(2026, 12, 1, 10, 0, 0, 123456)
    assert info.expiry_time.tzinfo is None
    assert info.auto_renewing is True
    assert info.acknowledged is True
    assert info.account_id == ACCOUNT
    assert info.package_name == PACKAGE


def test_pending_acknowledgement_and_auto_renew_off(sa_file):
    items = [{"productId": "luna_ai_monthly", "expiryTime": "2026-12-01T10:00:00Z", "autoRenewingPlan": {}}]
    v, _ = make(sa_file, [FakeResponse(200, sub(line_items=items, ack="ACKNOWLEDGEMENT_STATE_PENDING"))])
    info = run(v.get(TOKEN))
    assert info.acknowledged is False
    assert info.auto_renewing is False  # proto3 JSON omits false booleans


def test_missing_ack_state_and_plan_default_to_false(sa_file):
    items = [{"productId": "luna_ai_monthly", "expiryTime": "2026-12-01T10:00:00Z"}]
    v, _ = make(sa_file, [FakeResponse(200, sub(line_items=items, ack=None))])
    info = run(v.get(TOKEN))
    assert info.acknowledged is False
    assert info.auto_renewing is False


def test_missing_external_account_identifiers_gives_none(sa_file):
    v, _ = make(sa_file, [FakeResponse(200, sub(account=None))])
    assert run(v.get(TOKEN)).account_id is None


def test_empty_external_account_identifiers_gives_none(sa_file):
    body = sub(account=None)
    body["externalAccountIdentifiers"] = {}
    v, _ = make(sa_file, [FakeResponse(200, body)])
    assert run(v.get(TOKEN)).account_id is None


@pytest.mark.parametrize(
    "stamp, expected",
    [
        ("2026-12-01T10:00:00Z", datetime(2026, 12, 1, 10, 0, 0)),
        ("2026-12-01T10:00:00.5Z", datetime(2026, 12, 1, 10, 0, 0, 500000)),
        ("2026-12-01T15:30:00+05:30", datetime(2026, 12, 1, 10, 0, 0)),
        ("2026-12-01T05:00:00-05:00", datetime(2026, 12, 1, 10, 0, 0)),
        ("2026-12-01T10:00:00.123456789+00:00", datetime(2026, 12, 1, 10, 0, 0, 123456)),
    ],
)
def test_timestamps_with_z_and_offsets(sa_file, stamp, expected):
    items = [{"productId": "luna_ai_monthly", "expiryTime": stamp}]
    v, _ = make(sa_file, [FakeResponse(200, sub(line_items=items))])
    assert run(v.get(TOKEN)).expiry_time == expected


def test_multiple_line_items_pick_allowed_with_latest_expiry(sa_file):
    items = [
        {"productId": "someone_elses_product", "expiryTime": "2030-01-01T00:00:00Z", "autoRenewingPlan": {"autoRenewEnabled": True}},
        {"productId": "luna_ai_monthly", "expiryTime": "2026-12-01T10:00:00Z", "autoRenewingPlan": {"autoRenewEnabled": True}},
        {"productId": "luna_ai_yearly", "expiryTime": "2027-11-01T10:00:00Z"},
    ]
    v, _ = make(sa_file, [FakeResponse(200, sub(line_items=items))])
    info = run(v.get(TOKEN))
    assert info.product_id == "luna_ai_yearly"
    assert info.expiry_time == datetime(2027, 11, 1, 10, 0, 0)
    assert info.auto_renewing is False


def test_no_allowed_line_item_is_invalid(sa_file):
    items = [{"productId": "someone_elses_product", "expiryTime": "2030-01-01T00:00:00Z"}]
    v, _ = make(sa_file, [FakeResponse(200, sub(line_items=items))])
    with pytest.raises(VerifierError) as exc:
        run(v.get(TOKEN))
    assert exc.value.kind == "invalid"


def _without(key):
    body = sub()
    del body[key]
    return body


@pytest.mark.parametrize(
    "response",
    [
        FakeResponse(200, text="not json"),
        FakeResponse(200, ["a", "list"]),
        FakeResponse(200, _without("subscriptionState")),
        FakeResponse(200, _without("lineItems")),
        FakeResponse(200, sub(line_items=[])),
        FakeResponse(200, sub(state=7)),
        FakeResponse(200, sub(line_items="nope")),
        FakeResponse(200, sub(line_items=["nope"])),
        FakeResponse(200, sub(line_items=[{"productId": "luna_ai_monthly"}])),
        FakeResponse(200, sub(line_items=[{"productId": "luna_ai_monthly", "expiryTime": "soon"}])),
        FakeResponse(200, sub(line_items=[{"productId": "luna_ai_monthly", "expiryTime": 12345}])),
        FakeResponse(200, sub(line_items=[{"productId": "luna_ai_monthly", "expiryTime": "2026-12-01T10:00:00Z", "autoRenewingPlan": "yes"}])),
        FakeResponse(200, {**sub(), "externalAccountIdentifiers": "x"}),
        FakeResponse(200, {**sub(), "externalAccountIdentifiers": {"obfuscatedExternalAccountId": 5}}),
    ],
)
def test_malformed_responses_are_invalid(sa_file, response):
    v, _ = make(sa_file, [response])
    with pytest.raises(VerifierError) as exc:
        run(v.get(TOKEN))
    assert exc.value.kind == "invalid"


# --- error mapping ----------------------------------------------------------------


@pytest.mark.parametrize(
    "outcome, kind",
    [
        (FakeResponse(404, {"error": {"code": 404, "message": f"token {TOKEN} not found"}}), "revoked"),
        (FakeResponse(410, {"error": {"code": 410}}), "revoked"),
        (FakeResponse(400, {"error": {"code": 400, "message": f"bad {TOKEN}"}}), "invalid"),
        (FakeResponse(401, {"error": {"code": 401}}), "network"),
        (FakeResponse(403, {"error": {"code": 403}}), "network"),
        (FakeResponse(429, {"error": {"code": 429}}), "network"),
        (FakeResponse(500, text="boom"), "network"),
        (FakeResponse(502, text="bad gateway"), "network"),
        (FakeResponse(503, text="unavailable"), "network"),
        (httpx.ReadTimeout(f"timeout for {TOKEN}"), "network"),
        (httpx.ConnectError(f"cannot connect {TOKEN}"), "network"),
        (httpx.RemoteProtocolError(f"protocol {TOKEN}"), "network"),
    ],
)
def test_get_error_mapping_never_leaks_token(sa_file, caplog, outcome, kind):
    caplog.set_level(logging.DEBUG)
    v, _ = make(sa_file, [outcome])
    with pytest.raises(VerifierError) as exc:
        run(v.get(TOKEN))
    assert exc.value.kind == kind
    assert TOKEN not in str(exc.value)
    assert TOKEN not in repr(exc.value)
    assert quote(TOKEN, safe="") not in str(exc.value)
    # No chained exception (an httpx error would carry the URL, which holds the token).
    assert exc.value.__cause__ is None
    assert exc.value.__context__ is None or exc.value.__suppress_context__
    assert TOKEN not in caplog.text
    assert quote(TOKEN, safe="") not in caplog.text


def test_success_logs_never_contain_token(sa_file, caplog):
    caplog.set_level(logging.DEBUG)
    v, _ = make(sa_file, [FakeResponse(200, sub()), FakeResponse(200, None, text="")])
    info = run(v.get(TOKEN))
    run(v.acknowledge(TOKEN, "luna_ai_monthly"))
    assert TOKEN not in caplog.text
    assert TOKEN not in repr(v)
    assert TOKEN not in repr(info)


# --- acknowledge ------------------------------------------------------------------

ACK_URL = (
    f"{BASE}/{PACKAGE}/purchases/subscriptions/luna_ai_monthly/tokens/{quote(TOKEN, safe='')}:acknowledge"
)


def test_acknowledge_call_shape(sa_file):
    v, http = make(sa_file, [FakeResponse(200, None, text="")])
    assert run(v.acknowledge(TOKEN, "luna_ai_monthly")) is None
    (call,) = http.api_calls
    assert call["method"] == "POST"
    assert call["url"] == ACK_URL
    assert call["headers"]["Authorization"] == "Bearer access-1"
    assert call["json"] == {}


def test_acknowledge_204_is_ok(sa_file):
    v, _ = make(sa_file, [FakeResponse(204, None, text="")])
    run(v.acknowledge(TOKEN, "luna_ai_monthly"))


def test_acknowledge_already_acknowledged_400_is_not_an_error(sa_file):
    already = FakeResponse(400, {"error": {"code": 400, "message": "The purchase has already been acknowledged."}})
    v, http = make(sa_file, [already, FakeResponse(200, sub(ack="ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED"))])
    run(v.acknowledge(TOKEN, "luna_ai_monthly"))
    assert [c["method"] for c in http.api_calls] == ["POST", "GET"]  # confirmed with Google


def test_acknowledge_400_while_still_pending_is_invalid(sa_file):
    bad = FakeResponse(400, {"error": {"code": 400, "message": "Invalid request"}})
    v, _ = make(sa_file, [bad, FakeResponse(200, sub(ack="ACKNOWLEDGEMENT_STATE_PENDING"))])
    with pytest.raises(VerifierError) as exc:
        run(v.acknowledge(TOKEN, "luna_ai_monthly"))
    assert exc.value.kind == "invalid"


def test_acknowledge_rejects_product_not_allowed(sa_file):
    v, http = make(sa_file, [])
    with pytest.raises(VerifierError) as exc:
        run(v.acknowledge(TOKEN, "someone_elses_product"))
    assert exc.value.kind == "invalid"
    assert http.calls == []


@pytest.mark.parametrize(
    "outcome, kind",
    [
        (FakeResponse(404, {"error": {"code": 404}}), "revoked"),
        (FakeResponse(410, {"error": {"code": 410}}), "revoked"),
        (FakeResponse(403, {"error": {"code": 403}}), "network"),
        (FakeResponse(429, {"error": {"code": 429}}), "network"),
        (FakeResponse(503, text="unavailable"), "network"),
        (httpx.ReadTimeout("timeout"), "network"),
    ],
)
def test_acknowledge_error_mapping(sa_file, caplog, outcome, kind):
    caplog.set_level(logging.DEBUG)
    v, _ = make(sa_file, [outcome])
    with pytest.raises(VerifierError) as exc:
        run(v.acknowledge(TOKEN, "luna_ai_monthly"))
    assert exc.value.kind == kind
    assert TOKEN not in str(exc.value)
    assert TOKEN not in caplog.text


def test_default_http_layer_uses_httpx_with_10s_timeout(monkeypatch, sa_file):
    """The default seam builds an httpx client with a 10 s timeout; no request is sent."""
    from app.services.billing import google as google_module

    seen = {}

    class NoNetworkClient:
        def __init__(self, *, timeout):
            seen["timeout"] = timeout

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def request(self, method, url, **kw):
            seen["method"], seen["url"] = method, url
            return httpx.Response(200, json={"access_token": "x", "expires_in": 3600})

    monkeypatch.setattr(google_module.httpx, "AsyncClient", NoNetworkClient)
    http = google_module.HttpxTransport()
    response = run(http.request("POST", TOKEN_URL, data={"a": "b"}))
    assert response.status_code == 200
    assert seen == {"timeout": httpx.Timeout(10), "method": "POST", "url": TOKEN_URL}


# --- final-review fixes: httpx request logging and a hard total timeout ----------------------

def _mock_google(request):
    if request.url.host == "oauth2.googleapis.com":
        return httpx.Response(200, json={"access_token": "access-x", "expires_in": 3600})
    if request.url.path.endswith(":acknowledge"):
        return httpx.Response(204)
    return httpx.Response(200, json=sub())


def test_httpx_request_logs_never_contain_the_token(sa_file, caplog):
    from app.services.billing import google as google_module

    logging.basicConfig(level=logging.INFO)
    caplog.set_level(logging.DEBUG)
    http = google_module.HttpxTransport(transport=httpx.MockTransport(_mock_google))
    v = GoogleVerifier(http=http, package_name=PACKAGE, product_ids=PRODUCTS, service_account_file=sa_file)

    assert run(v.get(TOKEN)).product_id == "luna_ai_monthly"
    run(v.acknowledge(TOKEN, "luna_ai_monthly"))

    for record in caplog.records:
        message = record.getMessage()
        assert TOKEN not in message and quote(TOKEN, safe="") not in message, record.name
        assert "googleapis.com" not in message, record.name


def test_httpx_logging_still_works_for_other_hosts(caplog):
    """The filter only drops Google Play/OAuth records; it does not silence httpx for the app."""
    from app.services.billing import google  # noqa: F401  (installs the filter)

    caplog.set_level(logging.DEBUG)

    async def call():
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(200))) as client:
            await client.get("https://example.test/ping")

    run(call())
    assert any("example.test/ping" in r.getMessage() for r in caplog.records if r.name == "httpx")


def test_log_filter_is_installed_once(monkeypatch):
    import importlib

    from app.services.billing import google as google_module

    importlib.reload(google_module)
    importlib.reload(google_module)
    for name in google_module.FILTERED_LOGGERS:
        installed = [f for f in logging.getLogger(name).filters if getattr(f, "luna_google_filter", False)]
        assert len(installed) == 1, name


def test_slow_google_hits_the_total_timeout_as_network(sa_file):
    class SlowHttp(FakeHttp):
        async def request(self, method, url, **kw):
            await asyncio.sleep(5)

    v = GoogleVerifier(http=SlowHttp(), package_name=PACKAGE, product_ids=PRODUCTS,
                       service_account_file=sa_file, total_timeout=0.05)
    with pytest.raises(VerifierError) as err:
        run(v.get(TOKEN))
    assert err.value.kind == "network" and TOKEN not in str(err.value)


def test_slow_api_call_after_the_token_fetch_hits_the_total_timeout(sa_file):
    class SlowApi(FakeHttp):
        async def request(self, method, url, **kw):
            if url == TOKEN_URL:
                return await super().request(method, url, **kw)
            await asyncio.sleep(5)

    v = GoogleVerifier(http=SlowApi(), package_name=PACKAGE, product_ids=PRODUCTS,
                       service_account_file=sa_file, total_timeout=0.05)
    with pytest.raises(VerifierError) as err:
        run(v.acknowledge(TOKEN, "luna_ai_monthly"))
    assert err.value.kind == "network"


def test_default_total_timeout_is_12_seconds(sa_file):
    from app.services.billing import google as google_module

    assert google_module.TOTAL_TIMEOUT_SECONDS == 12
    assert GoogleVerifier(http=FakeHttp(), service_account_file=sa_file)._total_timeout == 12
