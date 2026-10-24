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
