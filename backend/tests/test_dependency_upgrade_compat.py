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


# The access log's route template must be the full, prefixed path. fastapi is pinned below 0.137
# for this: from 0.137 scope["route"] is the router's own route, without the include prefix.
PIN_HINT = (
    "access-log route template lost its router prefix: fastapi>=0.137 changed scope['route']; "
    "keep the fastapi==0.136.3 pin in backend/requirements.txt or rework "
    "_route_template in backend/app/core/middleware.py"
)


@pytest.mark.parametrize(
    "method, path, template",
    [
        ("GET", "/api/v1/periods/00000000-0000-4000-8000-000000000000", "/api/v1/periods/{period_id}"),
        ("PUT", "/api/v1/logs/2026-10-01", "/api/v1/logs/{log_date}"),
        ("GET", "/api/v1/auth/status", "/api/v1/auth/status"),
        ("POST", "/api/v1/auth/login", "/api/v1/auth/login"),
    ],
)
def test_route_template_keeps_the_router_prefix(client, monkeypatch, method, path, template):
    from app.core import middleware

    seen = []
    original = middleware._route_template

    def spy(scope):
        seen.append(original(scope))
        return seen[-1]

    monkeypatch.setattr(middleware, "_route_template", spy)
    client.request(method, path, json={})
    assert seen == [template], PIN_HINT


def test_unmatched_paths_still_log_the_placeholder(client, monkeypatch):
    from app.core import middleware

    seen = []
    original = middleware._route_template
    monkeypatch.setattr(middleware, "_route_template", lambda scope: seen.append(original(scope)) or seen[-1])
    client.get("/api/v1/no-such-route/123")
    assert seen == [middleware.UNMATCHED_ROUTE]


# LunaHTTPBearer honours auto_error like FastAPI's HTTPBearer (the app uses the default, True).
def _request(authorization=None):
    from starlette.requests import Request

    headers = [(b"authorization", authorization.encode())] if authorization is not None else []
    return Request({"type": "http", "method": "GET", "path": "/", "headers": headers, "query_string": b""})


@pytest.mark.parametrize("value", [None, "", "Basic dXNlcjpwYXNz"])
def test_bearer_without_auto_error_returns_none(value):
    import asyncio

    from app.api.auth import LunaHTTPBearer

    assert asyncio.run(LunaHTTPBearer(auto_error=False)(_request(value))) is None


def test_bearer_without_auto_error_still_returns_credentials():
    import asyncio

    from app.api.auth import LunaHTTPBearer

    creds = asyncio.run(LunaHTTPBearer(auto_error=False)(_request("Bearer abc.def.ghi")))
    assert (creds.scheme, creds.credentials) == ("Bearer", "abc.def.ghi")


def test_app_bearer_errors_by_default():
    from app.api.auth import security

    assert security.auto_error is True
