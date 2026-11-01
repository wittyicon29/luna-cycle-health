def test_login_is_rate_limited(client):
    payload = {"email": "nobody@gmail.com", "password": "wrongpass1"}

    codes = [client.post("/api/v1/auth/login", json=payload).status_code for _ in range(6)]

    assert codes[:5] == [401] * 5
    assert codes[5] == 429


def test_password_reset_request_is_rate_limited(client, outbox):
    payload = {"email": "nobody@gmail.com"}

    codes = [client.post("/api/v1/auth/request-password-reset", json=payload).status_code for _ in range(6)]

    assert codes[:5] == [200] * 5
    assert codes[5] == 429


def test_limits_reset_between_tests(client):
    payload = {"email": "nobody@gmail.com", "password": "wrongpass1"}

    assert client.post("/api/v1/auth/login", json=payload).status_code == 401


def test_analysis_post_is_rate_limited_like_chat(client, auth_headers):
    client.post("/api/v1/consents", json={"purpose": "ai_processing", "granted": True}, headers=auth_headers)
    body = {"analysis_type": "cycle_health"}

    codes = [client.post("/api/v1/analysis/", json=body, headers=auth_headers).status_code for _ in range(51)]

    assert codes[:50] == [400] * 50  # no periods yet
    assert codes[50] == 429
