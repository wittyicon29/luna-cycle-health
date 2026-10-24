import time

import pytest
from jose import jwt
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
    from jose import jwk

    jwk_public = jwk.RSAKey(
        algorithm="RS256",
        key=private.public_key().public_bytes(
            serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
        ).decode(),
    ).to_dict()
    jwk_public["kid"] = "kid-1"
    return pem.decode(), jwk_public


@pytest.fixture(autouse=True)
def configured(monkeypatch, keypair):
    monkeypatch.setattr(settings, "GOOGLE_ID_TOKEN_AUDIENCES", AUD)
    monkeypatch.setitem(google_id_token._cache, "keys", [])
    monkeypatch.setitem(google_id_token._cache, "fetched_at", 0.0)
    monkeypatch.setattr(google_id_token, "_last_forced_refresh", 0.0)
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
    monkeypatch.setattr(google_id_token, "_last_forced_refresh", time.time())

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
