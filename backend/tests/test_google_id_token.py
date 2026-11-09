import json
import time

import jwt
import pytest
from jwt.algorithms import RSAAlgorithm
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from app.core.config import settings
from app.services import google_id_token

AUD = "web-client-123.apps.googleusercontent.com"
URL = "/api/v1/auth/google/id-token"


@pytest.fixture(scope="module")
def keypair():
    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem = private.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    )
    # The shape Google publishes at oauth2/v3/certs: kty, n, e, alg, kid (and use).
    jwk_public = json.loads(RSAAlgorithm.to_jwk(private.public_key()))
    jwk_public.update({"alg": "RS256", "kid": "kid-1", "use": "sig"})
    return pem.decode(), jwk_public


@pytest.fixture(autouse=True)
def configured(monkeypatch, keypair):
    monkeypatch.setattr(settings, "GOOGLE_ID_TOKEN_AUDIENCES", AUD)
    monkeypatch.setitem(google_id_token._cache, "keys", [])
    monkeypatch.setitem(google_id_token._cache, "fetched_at", 0.0)
    monkeypatch.setattr(google_id_token, "_last_fetch_attempt", 0.0)
    fetches = {"n": 0}

    async def fake_fetch():
        fetches["n"] += 1
        return [keypair[1]]

    monkeypatch.setattr(google_id_token, "_fetch_google_keys", fake_fetch)
    return fetches


def make_token(keypair, **overrides):
    claims = {
        "iss": "https://accounts.google.com",
        "aud": AUD,
        "sub": "123",
        "email": "native@gmail.com",
        "email_verified": True,
        "iat": int(time.time()),
        "exp": int(time.time()) + 600,
    }
    claims.update(overrides)
    claims = {k: v for k, v in claims.items() if v is not None}
    return jwt.encode(claims, keypair[0], algorithm="RS256", headers={"kid": "kid-1"})


def post(client, token, accepted=True, adult=True):
    return client.post(
        URL,
        json={"id_token": token, "accepted_privacy_policy": accepted, "confirmed_18_plus": adult},
    )


def test_valid_token_creates_verified_user_and_returns_tokens(client, db, keypair):
    from app.models.models import User

    response = post(client, make_token(keypair))

    assert response.status_code == 200
    body = response.json()
    assert body["access_token"] and body["refresh_token"]
    assert body["user"]["email"] == "native@gmail.com"
    user = db.query(User).filter(User.email == "native@gmail.com").one()
    assert user.is_email_verified is True
    assert user.hashed_password == ""


@pytest.mark.parametrize(
    "overrides",
    [
        {"aud": "someone-elses-client"},
        {"iss": "https://evil.example.com"},
        {"exp": int(time.time()) - 10},
        {"email_verified": False},
        {"email_verified": "true"},
        {"email_verified": None},
        {"email": None},
    ],
)
def test_invalid_claims_are_rejected_and_create_nothing(client, db, keypair, overrides):
    from app.models.models import User

    response = post(client, make_token(keypair, **overrides))

    assert response.status_code == 400
    assert db.query(User).count() == 0


def test_non_gmail_address_is_rejected(client, db, keypair):
    from app.models.models import User

    response = post(client, make_token(keypair, email="person@example.org"))

    assert response.status_code == 400
    assert db.query(User).count() == 0


def test_hs256_and_none_algorithms_are_rejected(client, db, keypair):
    from app.models.models import User

    claims = {"iss": "accounts.google.com", "aud": AUD, "email": "x@gmail.com",
              "email_verified": True, "exp": int(time.time()) + 600}
    hs = jwt.encode(claims, "secret", algorithm="HS256", headers={"kid": "kid-1"})
    assert post(client, hs).status_code == 400
    none = "eyJhbGciOiJub25lIiwia2lkIjoia2lkLTEifQ." + "e30" + "."
    assert post(client, none).status_code == 400
    assert db.query(User).count() == 0


def test_tampered_signature_is_rejected(client, keypair):
    token = make_token(keypair)
    head, payload, sig = token.split(".")
    bad = ".".join([head, payload, sig[:-4] + ("AAAA" if not sig.endswith("AAAA") else "BBBB")])
    assert post(client, bad).status_code == 400


def test_unknown_kid_is_rejected_and_refetch_is_rate_limited(client, keypair, configured, monkeypatch):
    claims = {"iss": "accounts.google.com", "aud": AUD, "email": "x@gmail.com",
              "email_verified": True, "exp": int(time.time()) + 600}
    token = jwt.encode(claims, keypair[0], algorithm="RS256", headers={"kid": "unknown"})
    monkeypatch.setattr(google_id_token, "_last_fetch_attempt", time.time())

    assert post(client, token).status_code == 400
    # the cached lookup ran once; a forced refresh inside the cooldown must not hit the network again
    assert configured["n"] == 1


def test_new_user_without_consent_flags_gets_consent_required(client, db, keypair):
    from app.models.models import User

    response = post(client, make_token(keypair), accepted=False, adult=False)

    assert response.status_code == 400
    assert response.json()["detail"] == {"code": "consent_required", "purposes": ["terms_privacy", "age_18_plus"]}
    assert db.query(User).count() == 0


def test_unverified_existing_account_is_taken_over_with_consent(client, db, make_user, keypair):
    user = make_user(email="native@gmail.com", password="attackerpw1", verified=False)

    response = post(client, make_token(keypair))

    assert response.status_code == 200
    db.expire_all()
    db.refresh(user)
    assert user.is_email_verified is True
    assert user.hashed_password == ""


def test_verified_existing_account_signs_in_without_flags(client, db, make_user, keypair):
    make_user(email="native@gmail.com", password="mypassword1", verified=True)

    response = post(client, make_token(keypair), accepted=False, adult=False)

    assert response.status_code == 200


def test_unconfigured_audience_allowlist_returns_503(client, keypair, monkeypatch):
    monkeypatch.setattr(settings, "GOOGLE_ID_TOKEN_AUDIENCES", "")
    assert post(client, make_token(keypair)).status_code == 503


def test_audience_as_list_fails_closed(client, keypair):
    # Google issues a single string aud; a list is never accepted, even if it contains ours.
    assert post(client, make_token(keypair, aud=[AUD])).status_code == 400


def test_token_without_exp_is_rejected(client, db, keypair):
    from app.models.models import User

    response = post(client, make_token(keypair, exp=None))
    assert response.status_code == 400
    assert response.json()["detail"] == "Google sign-in could not be verified"
    assert db.query(User).count() == 0


def test_token_without_iat_is_rejected(client, keypair):
    assert post(client, make_token(keypair, iat=None)).status_code == 400


def test_fetch_failure_returns_503(client, keypair, monkeypatch):
    from fastapi import HTTPException

    async def boom():
        raise HTTPException(status_code=503, detail="Google sign-in is temporarily unavailable")

    monkeypatch.setattr(google_id_token, "_fetch_google_keys", boom)
    response = post(client, make_token(keypair))
    assert response.status_code == 503
    assert response.json()["detail"] == "Google sign-in is temporarily unavailable"


@pytest.mark.parametrize(
    "payload",
    [[], {"keys": "x"}, {"keys": [1]}, {"keys": []}, {}, {"nokeys": []}],
)
def test_malformed_keys_payload_returns_503(client, keypair, monkeypatch, payload):
    class FakeResponse:
        def raise_for_status(self):
            pass

        def json(self):
            return payload

    class FakeClient:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def get(self, url):
            return FakeResponse()

    monkeypatch.undo()  # drop the _fetch_google_keys stub, keep the real function
    monkeypatch.setattr(settings, "GOOGLE_ID_TOKEN_AUDIENCES", AUD)
    monkeypatch.setattr(google_id_token.httpx, "AsyncClient", FakeClient)
    response = post(client, make_token(keypair))
    assert response.status_code == 503
    assert response.json()["detail"] == "Google sign-in is temporarily unavailable"


def test_bad_jwk_modulus_is_never_a_500(client, keypair, monkeypatch):
    bad = dict(keypair[1], n="!!not-base64!!")

    async def fake():
        return [bad]

    monkeypatch.setattr(google_id_token, "_fetch_google_keys", fake)
    response = post(client, make_token(keypair))
    assert response.status_code == 400
    assert response.json()["detail"] == "Google sign-in could not be verified"


def test_cold_cache_unknown_kid_fetches_once_and_cooldown_holds(client, keypair, configured):
    claims = {"iss": "accounts.google.com", "aud": AUD, "email": "x@gmail.com",
              "email_verified": True, "iat": int(time.time()), "exp": int(time.time()) + 600}
    token = jwt.encode(claims, keypair[0], algorithm="RS256", headers={"kid": "unknown"})

    for _ in range(3):
        assert post(client, token).status_code == 400
    # the first request's cold fetch counts as the attempt; forced refreshes stay inside the cooldown
    assert configured["n"] == 1


def test_stale_keys_are_used_when_refetch_fails(client, keypair, monkeypatch):
    from fastapi import HTTPException

    monkeypatch.setitem(google_id_token._cache, "keys", [keypair[1]])
    monkeypatch.setitem(google_id_token._cache, "fetched_at", time.time() - 7200)
    calls = {"n": 0}

    async def boom():
        calls["n"] += 1
        raise HTTPException(status_code=503, detail="Google sign-in is temporarily unavailable")

    monkeypatch.setattr(google_id_token, "_fetch_google_keys", boom)
    assert post(client, make_token(keypair)).status_code == 200
    assert calls["n"] == 1


def test_hs256_token_claiming_rs256_header_is_rejected(client, db, keypair):
    # Key-confusion attempt: HMAC-sign with the public key bytes while the header says RS256.
    # Passes the header check, so only the algorithms=["RS256"] pin in decode stops it.
    import base64
    import hashlib
    import hmac
    import json

    from app.models.models import User

    def b64(raw):
        return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()

    header = b64(json.dumps({"alg": "RS256", "kid": "kid-1", "typ": "JWT"}).encode())
    claims = {"iss": "accounts.google.com", "aud": AUD, "email": "x@gmail.com",
              "email_verified": True, "iat": int(time.time()), "exp": int(time.time()) + 600}
    body = b64(json.dumps(claims).encode())
    signing = f"{header}.{body}".encode()
    sig = b64(hmac.new(keypair[1]["n"].encode(), signing, hashlib.sha256).digest())
    assert post(client, f"{header}.{body}.{sig}").status_code == 400
    assert db.query(User).count() == 0


# --- PyJWT migration: token semantics pinned explicitly ----------------------------------------

INVALID = "Google sign-in could not be verified"


def _b64(raw: bytes) -> str:
    import base64

    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _claims(**overrides):
    claims = {"iss": "https://accounts.google.com", "aud": AUD, "sub": "123", "email": "native@gmail.com",
              "email_verified": True, "iat": int(time.time()), "exp": int(time.time()) + 600}
    claims.update(overrides)
    return {k: v for k, v in claims.items() if v is not None}


def _sign_rs256(keypair, claims, header=None) -> str:
    """Sign without PyJWT's encode-time claim checks, to forge claims it refuses to encode."""
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric import padding

    private = serialization.load_pem_private_key(keypair[0].encode(), password=None)
    head = _b64(json.dumps(header or {"alg": "RS256", "kid": "kid-1", "typ": "JWT"}).encode())
    body = _b64(json.dumps(claims).encode())
    signing = f"{head}.{body}".encode()
    return f"{head}.{body}.{_b64(private.sign(signing, padding.PKCS1v15(), hashes.SHA256()))}"


def test_raw_signer_produces_valid_tokens(client, keypair):
    assert post(client, _sign_rs256(keypair, _claims())).status_code == 200


def _assert_invalid(client, db, token):
    from app.models.models import User

    response = post(client, token)
    assert response.status_code == 400, response.text
    assert response.json()["detail"] == INVALID
    assert db.query(User).count() == 0


def _public_pem(keypair) -> bytes:
    key = RSAAlgorithm.from_jwk(keypair[1])
    return key.public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)


def test_valid_token_round_trip_returns_claims(keypair):
    import asyncio

    claims = asyncio.run(google_id_token.verify_google_id_token(make_token(keypair)))
    assert claims["email"] == "native@gmail.com" and claims["aud"] == AUD and claims["sub"] == "123"


def test_both_google_issuer_spellings_are_accepted(client, keypair):
    assert post(client, make_token(keypair, iss="accounts.google.com")).status_code == 200


def test_tampered_payload_is_rejected(client, db, keypair):
    head, _, sig = make_token(keypair).split(".")
    forged = _b64(json.dumps(_claims(email="victim@gmail.com")).encode())
    _assert_invalid(client, db, f"{head}.{forged}.{sig}")


def test_expired_token_is_rejected(client, db, keypair):
    _assert_invalid(client, db, make_token(keypair, iat=int(time.time()) - 7200, exp=int(time.time()) - 1))


def test_no_leeway_on_exp(client, db, keypair):
    _assert_invalid(client, db, make_token(keypair, exp=int(time.time()) - 2))


def test_not_yet_valid_nbf_is_rejected(client, db, keypair):
    _assert_invalid(client, db, make_token(keypair, nbf=int(time.time()) + 600))


def test_iat_slightly_in_the_future_is_accepted_as_before(client, keypair):
    # python-jose never compared iat with the clock; PyJWT does unless verify_iat is off. A few
    # seconds of clock skew against Google must not break sign-in.
    assert post(client, make_token(keypair, iat=int(time.time()) + 30)).status_code == 200


@pytest.mark.parametrize("iat", ["not-a-number", [1], {"t": 1}])
def test_non_integer_iat_is_rejected(client, db, keypair, iat):
    _assert_invalid(client, db, _sign_rs256(keypair, _claims(iat=iat)))


@pytest.mark.parametrize("exp", ["soon", [1]])
def test_non_integer_exp_is_rejected(client, db, keypair, exp):
    _assert_invalid(client, db, _sign_rs256(keypair, _claims(exp=exp)))


@pytest.mark.parametrize("aud", ["someone-elses-client", "", [AUD, "other"], {"aud": AUD}, 5])
def test_wrong_or_non_string_audience_is_rejected(client, db, keypair, aud):
    _assert_invalid(client, db, make_token(keypair, aud=aud))


def test_missing_audience_is_rejected(client, db, keypair):
    claims = _claims()
    del claims["aud"]
    _assert_invalid(client, db, jwt.encode(claims, keypair[0], algorithm="RS256", headers={"kid": "kid-1"}))


@pytest.mark.parametrize("iss", ["https://evil.example.com", "https://accounts.google.com/", "",
                                 ["https://accounts.google.com"], {"iss": "accounts.google.com"}, 7])
def test_wrong_or_non_string_issuer_is_rejected(client, db, keypair, iss):
    _assert_invalid(client, db, _sign_rs256(keypair, _claims(iss=iss)))


def test_missing_issuer_is_rejected(client, db, keypair):
    claims = _claims()
    del claims["iss"]
    _assert_invalid(client, db, jwt.encode(claims, keypair[0], algorithm="RS256", headers={"kid": "kid-1"}))


@pytest.mark.parametrize("sub", [123, ["123"], None])
def test_non_string_sub_is_rejected(client, db, keypair, sub):
    claims = _claims()
    claims["sub"] = sub  # None stays in the payload as JSON null
    _assert_invalid(client, db, _sign_rs256(keypair, claims))


@pytest.mark.parametrize("header", [{"alg": "none", "kid": "kid-1"}, {"alg": "None", "kid": "kid-1"},
                                    {"alg": "RS256", "kid": "kid-1"}])
def test_unsigned_tokens_are_rejected(client, db, header, keypair):
    head = _b64(json.dumps(header).encode())
    body = _b64(json.dumps(_claims()).encode())
    _assert_invalid(client, db, f"{head}.{body}.")


def test_hs256_signed_with_the_public_key_pem_is_rejected(client, db, keypair):
    # The classic RS256 -> HS256 confusion: the attacker HMACs with the public key's PEM bytes.
    import hashlib
    import hmac

    pem = _public_pem(keypair)
    for alg in ("HS256", "RS256"):
        head = _b64(json.dumps({"alg": alg, "kid": "kid-1", "typ": "JWT"}).encode())
        body = _b64(json.dumps(_claims()).encode())
        sig = _b64(hmac.new(pem, f"{head}.{body}".encode(), hashlib.sha256).digest())
        _assert_invalid(client, db, f"{head}.{body}.{sig}")


def test_hs256_header_is_refused_before_any_key_lookup(client, db, keypair, configured):
    token = jwt.encode(_claims(), "x" * 32, algorithm="HS256", headers={"kid": "kid-1"})
    _assert_invalid(client, db, token)
    assert configured["n"] == 0  # rejected on the header alone


@pytest.mark.parametrize("alg", ["RS384", "RS512", "PS256"])
def test_other_rsa_algorithms_are_rejected(client, db, keypair, alg):
    _assert_invalid(client, db, jwt.encode(_claims(), keypair[0], algorithm=alg, headers={"kid": "kid-1"}))


def test_es256_token_is_rejected(client, db):
    from cryptography.hazmat.primitives.asymmetric import ec

    key = ec.generate_private_key(ec.SECP256R1())
    _assert_invalid(client, db, jwt.encode(_claims(), key, algorithm="ES256", headers={"kid": "kid-1"}))


def test_token_signed_by_another_key_with_a_known_kid_is_rejected(client, db):
    other = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    _assert_invalid(client, db, jwt.encode(_claims(), other, algorithm="RS256", headers={"kid": "kid-1"}))


def test_key_is_selected_by_kid_among_several(client, keypair, monkeypatch):
    other = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    decoy = json.loads(RSAAlgorithm.to_jwk(other.public_key()))
    decoy.update({"alg": "RS256", "kid": "kid-0", "use": "sig"})

    async def fake():
        return [decoy, keypair[1]]

    monkeypatch.setattr(google_id_token, "_fetch_google_keys", fake)
    assert post(client, make_token(keypair)).status_code == 200
    # the same token claiming the decoy's kid fails: the kid picks the key, nothing else is tried
    wrong = jwt.encode(_claims(), keypair[0], algorithm="RS256", headers={"kid": "kid-0"})
    assert post(client, wrong).status_code == 400


@pytest.mark.parametrize("kid", [None, "", 5, ["kid-1"]])
def test_missing_or_non_string_kid_is_rejected(client, db, keypair, kid):
    header = {"alg": "RS256", "typ": "JWT"}
    if kid is not None:
        header["kid"] = kid
    _assert_invalid(client, db, _sign_rs256(keypair, _claims(), header))


def test_non_rsa_jwk_for_the_kid_is_rejected(client, db, keypair, monkeypatch):
    async def fake():
        return [{"kty": "oct", "k": _b64(b"k" * 32), "kid": "kid-1", "alg": "HS256"}]

    monkeypatch.setattr(google_id_token, "_fetch_google_keys", fake)
    _assert_invalid(client, db, make_token(keypair))


@pytest.mark.parametrize(
    "token",
    [
        "not-a-jwt-at-all-but-long-enough",
        "aaaaaaaaaa.bbbbbbbbbb.cccccccccc",
        "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxIn0",  # two segments
        "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln.ZXh0cmE",  # four segments
        _b64(b"[1, 2]") + "." + _b64(b"{}") + ".c2lnbmF0dXJl",  # header is not an object
        _b64(b"{not json") + "." + _b64(b"{}") + ".c2lnbmF0dXJl",
        _b64(json.dumps({"alg": "RS256", "kid": "kid-1"}).encode()) + "." + _b64(b"[1]") + ".c2lnbmF0dXJl",
        _b64(json.dumps({"alg": "RS256", "kid": "kid-1"}).encode()) + ".!!!!.c2lnbmF0dXJl",
    ],
)
def test_malformed_tokens_are_400_not_500(client, db, token):
    _assert_invalid(client, db, token)
