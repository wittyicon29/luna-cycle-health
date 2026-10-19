from fastapi.testclient import TestClient

from app.main import app


def test_health_check():
    response = TestClient(app).get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "healthy"}


def test_root_endpoint():
    response = TestClient(app).get("/")

    assert response.status_code == 200
    assert response.json() == {
        "message": "Luna Health API",
        "status": "running",
        "version": "1.0.0",
    }
