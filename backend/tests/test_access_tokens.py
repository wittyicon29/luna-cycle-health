"""Access tokens (HS256, app.core.security) across the python-jose -> PyJWT swap.

Refresh tokens are opaque random strings stored as SHA-256 hashes (auth.refresh), not JWTs, so
the library change cannot affect them; only access tokens are covered here.
"""
import base64
import hashlib
import hmac
import json
import time
import uuid
from datetime import datetime, timedelta, timezone

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from app.core.config import settings
from app.core.security import create_access_token, decode_access_token

TEST_SECRET = "test-secret-key"  # tests/conftest.py
LEGACY_SUB = "3f2b8c1e-5d4a-4e7b-9c2a-1b6d8e0f4a77"
# Made by the pre-swap code (python-jose 3.3.0, app.core.security.create_access_token with
# SECRET_KEY=test-secret-key and a 70-year lifetime) in a one-off script before python-jose
# was removed. A token issued before the deploy must still be accepted after it.
LEGACY_ACCESS_TOKEN = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
    ".eyJzdWIiOiIzZjJiOGMxZS01ZDRhLTRlN2ItOWMyYS0xYjZkOGUwZjRhNzciLCJleHAiOjQwMDE3NTM3NzUsInR5cGUiOiJhY2Nlc3MifQ"
    ".KFA_dpjzyHYKDgN6xeoPzgegNW3ueP2qs9P4e8tb1uQ"
)
# Same code path, exp 1700000000 (2023-11-14): expired.
LEGACY_EXPIRED_TOKEN = (
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9"
    ".eyJzdWIiOiIzZjJiOGMxZS01ZDRhLTRlN2ItOWMyYS0xYjZkOGUwZjRhNzciLCJleHAiOjE3MDAwMDAwMDAsInR5cGUiOiJhY2Nlc3MifQ"
    ".U96aZmTHBaxIHmhd_cl_imBzHpp8mxqgLW9wb0LaqfQ"
)
STATUS = "/api/v1/auth/status"


def b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def hs256(claims, header=None, secret=TEST_SECRET) -> str:
    """Sign by hand (no library checks), to forge any header or claims."""
    head = b64(json.dumps(header or {"alg": "HS256", "typ": "JWT"}).encode())
    body = b64(json.dumps(claims).encode())
    sig = b64(hmac.new(secret.encode(), f"{head}.{body}".encode(), hashlib.sha256).digest())
    return f"{head}.{body}.{sig}"


def future(seconds=600) -> int:
    return int(time.time()) + seconds


def test_secret_is_the_one_the_legacy_fixtures_were_signed_with():
    assert settings.SECRET_KEY == TEST_SECRET and settings.ALGORITHM == "HS256"


# --- tokens issued before the swap -------------------------------------------------------------


def test_legacy_jose_token_still_decodes():
    assert decode_access_token(LEGACY_ACCESS_TOKEN) == {"sub": LEGACY_SUB, "exp": 4001753775, "type": "access"}


def test_legacy_expired_jose_token_is_rejected():
    assert decode_access_token(LEGACY_EXPIRED_TOKEN) is None


def test_legacy_jose_token_authenticates_its_user(client, db):
    from app.core.security import get_password_hash
    from app.models.models import User

    db.add(User(id=uuid.UUID(LEGACY_SUB), email="legacy@gmail.com",
                hashed_password=get_password_hash("password123"), is_email_verified=True))
    db.commit()
    response = client.get(STATUS, headers={"Authorization": f"Bearer {LEGACY_ACCESS_TOKEN}"})
    assert response.status_code == 200
    assert response.json()["email"] == "legacy@gmail.com"


def test_legacy_expired_token_is_401_invalid_token(client):
    response = client.get(STATUS, headers={"Authorization": f"Bearer {LEGACY_EXPIRED_TOKEN}"})
    assert response.status_code == 401 and response.json() == {"detail": "Invalid token"}


# --- tokens issued after the swap ----------------------------------------------------------------


def test_new_token_has_the_same_shape_as_before():
    token = create_access_token({"sub": LEGACY_SUB})
    assert jwt.get_unverified_header(token) == {"alg": "HS256", "typ": "JWT"}
    payload = jwt.decode(token, TEST_SECRET, algorithms=["HS256"])
    assert set(payload) == {"sub", "exp", "type"}
    assert payload["sub"] == LEGACY_SUB and payload["type"] == "access"
    assert isinstance(payload["exp"], int)  # an integer NumericDate, as python-jose wrote it
    expected = datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    assert abs(payload["exp"] - expected.timestamp()) < 5


def test_new_token_round_trips_and_does_not_mutate_input():
    data = {"sub": LEGACY_SUB}
    token = create_access_token(data)
    assert data == {"sub": LEGACY_SUB}
    assert decode_access_token(token)["sub"] == LEGACY_SUB


def test_new_token_verifies_with_a_plain_hmac_check():
    # Library-independent: the signature is HMAC-SHA256 over header.payload with SECRET_KEY.
    token = create_access_token({"sub": LEGACY_SUB})
    head, body, sig = token.split(".")
    expected = b64(hmac.new(TEST_SECRET.encode(), f"{head}.{body}".encode(), hashlib.sha256).digest())
    assert hmac.compare_digest(sig, expected)


# --- rejected tokens ---------------------------------------------------------------------------


def test_tampered_payload_is_rejected():
    head, _, sig = create_access_token({"sub": LEGACY_SUB}).split(".")
    forged = b64(json.dumps({"sub": str(uuid.uuid4()), "exp": future(), "type": "access"}).encode())
    assert decode_access_token(f"{head}.{forged}.{sig}") is None


def test_tampered_signature_is_rejected():
    head, body, sig = create_access_token({"sub": LEGACY_SUB}).split(".")
    flipped = sig[:-2] + ("AA" if not sig.endswith("AA") else "BB")
    assert decode_access_token(f"{head}.{body}.{flipped}") is None


def test_wrong_secret_is_rejected():
    assert decode_access_token(hs256({"sub": LEGACY_SUB, "exp": future()}, secret="another-secret-key")) is None


def test_expired_token_is_rejected_without_leeway():
    assert decode_access_token(hs256({"sub": LEGACY_SUB, "exp": int(time.time()) - 2})) is None


def test_expired_token_from_the_library_is_rejected():
    token = jwt.encode({"sub": LEGACY_SUB, "exp": int(time.time()) - 60}, TEST_SECRET, algorithm="HS256")
    assert decode_access_token(token) is None


def test_not_yet_valid_nbf_is_rejected():
    assert decode_access_token(hs256({"sub": LEGACY_SUB, "exp": future(), "nbf": future(300)})) is None


def test_token_without_exp_is_rejected():
    # Every access token ever issued carries exp; one without it is never accepted.
    assert decode_access_token(hs256({"sub": LEGACY_SUB, "type": "access"})) is None


@pytest.mark.parametrize("exp", ["tomorrow", [1], None])
def test_non_integer_exp_is_rejected(exp):
    assert decode_access_token(hs256({"sub": LEGACY_SUB, "exp": exp})) is None


@pytest.mark.parametrize("sub", [123, ["x"], {"id": 1}])
def test_non_string_sub_is_rejected(sub):
    # python-jose rejected a non-string sub too (JWTClaimsError); get_current_user answers 401.
    assert decode_access_token(hs256({"sub": sub, "exp": future()})) is None


def test_token_with_an_audience_is_rejected():
    # We never set aud; both libraries refuse a token with aud when no audience is expected.
    assert decode_access_token(hs256({"sub": LEGACY_SUB, "exp": future(), "aud": "luna"})) is None


@pytest.mark.parametrize("alg", ["none", "None", "NONE"])
def test_alg_none_is_rejected(alg):
    head = b64(json.dumps({"alg": alg, "typ": "JWT"}).encode())
    body = b64(json.dumps({"sub": LEGACY_SUB, "exp": future()}).encode())
    assert decode_access_token(f"{head}.{body}.") is None
    assert decode_access_token(f"{head}.{body}.c2ln") is None


@pytest.mark.parametrize("alg", ["HS384", "HS512"])
def test_other_hmac_algorithms_are_rejected(alg):
    token = jwt.encode({"sub": LEGACY_SUB, "exp": future()}, TEST_SECRET, algorithm=alg)
    assert decode_access_token(token) is None


def test_hs256_payload_with_rs256_header_is_rejected():
    assert decode_access_token(hs256({"sub": LEGACY_SUB, "exp": future()}, header={"alg": "RS256", "typ": "JWT"})) is None


def test_rs256_signed_token_is_rejected():
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    assert decode_access_token(jwt.encode({"sub": LEGACY_SUB, "exp": future()}, key, algorithm="RS256")) is None


@pytest.mark.parametrize(
    "token",
    ["", "garbage", "a.b", "a.b.c", "a.b.c.d", "....",
     b64(b"[1]") + "." + b64(b"{}") + ".c2ln",
     b64(b'{"alg":"HS256"}') + "." + b64(b"[1, 2]") + ".c2ln",
     b64(b'{"alg":"HS256"}') + "." + b64(b"not json") + ".c2ln",
     b64(b'{"alg":"HS256"}') + ".%%%%.c2ln",
     "ééé.éé.é"],
)
def test_malformed_tokens_return_none(token):
    assert decode_access_token(token) is None


@pytest.mark.parametrize(
    "token, detail",
    [("garbage", "Invalid token"), (LEGACY_EXPIRED_TOKEN, "Invalid token"),
     (hs256({"sub": 123, "exp": future()}), "Invalid token"),
     (hs256({"sub": "not-a-uuid", "exp": future()}), "Invalid user ID"),
     (hs256({"sub": str(uuid.uuid4()), "exp": future()}), "User not found")],
)
def test_api_answers_are_unchanged(client, token, detail):
    response = client.get(STATUS, headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 401
    assert response.json() == {"detail": detail}
