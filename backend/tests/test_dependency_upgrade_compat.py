"""Behaviour pinned across the 2026-11 dependency upgrades (FastAPI 0.115 -> 0.136, Starlette 0.38 -> 1.x).

FastAPI 0.122 changed HTTPBearer to answer missing or non-Bearer credentials with 401 and a
WWW-Authenticate header. Luna keeps the previous 403 answers: clients treat 401 as "access
token rejected, try the refresh token", and nothing else about the contract changes.
"""
import pytest

STATUS = "/api/v1/auth/status"


def test_missing_credentials_is_403_not_authenticated(client):
    response = client.get(STATUS)
    assert response.status_code == 403
    assert response.json() == {"detail": "Not authenticated"}
    assert "www-authenticate" not in response.headers


@pytest.mark.parametrize("value", ["", "Bearer", "Bearer ", "token-without-scheme"])
def test_empty_or_schemeless_authorization_is_403_not_authenticated(client, value):
    response = client.get(STATUS, headers={"Authorization": value})
    assert response.status_code == 403
    assert response.json() == {"detail": "Not authenticated"}
    assert "www-authenticate" not in response.headers


@pytest.mark.parametrize("value", ["Basic dXNlcjpwYXNz", "Token abc.def.ghi"])
def test_non_bearer_scheme_is_403_invalid_credentials(client, value):
    response = client.get(STATUS, headers={"Authorization": value})
    assert response.status_code == 403
    assert response.json() == {"detail": "Invalid authentication credentials"}
    assert "www-authenticate" not in response.headers


def test_bearer_scheme_is_case_insensitive(client, auth_headers):
    token = auth_headers["Authorization"].split()[1]
    assert client.get(STATUS, headers={"Authorization": f"bearer {token}"}).status_code == 200


def test_bad_bearer_token_is_still_401_invalid_token(client):
    response = client.get(STATUS, headers={"Authorization": "Bearer not.a.jwt"})
    assert response.status_code == 401
    assert response.json() == {"detail": "Invalid token"}


# FastAPI 0.13x made JSON body parsing require a JSON Content-Type by default
# (strict_content_type). Before, a body without any Content-Type was parsed as JSON; Luna keeps
# that (the app is configured with strict_content_type=False). A non-JSON Content-Type is still
# not parsed as JSON, as before.
LOGIN = "/api/v1/auth/login"


def test_json_body_without_content_type_is_still_parsed(client, make_user):
    make_user(email="nocontenttype@gmail.com", password="password123")
    body = b'{"email": "nocontenttype@gmail.com", "password": "password123"}'
    response = client.post(LOGIN, content=body)
    assert response.status_code == 200, response.text
    assert response.json()["token_type"] == "bearer"


def test_json_body_with_text_plain_is_still_rejected(client, make_user):
    make_user(email="textplain@gmail.com", password="password123")
    body = b'{"email": "textplain@gmail.com", "password": "password123"}'
    response = client.post(LOGIN, content=body, headers={"Content-Type": "text/plain"})
    assert response.status_code == 422
