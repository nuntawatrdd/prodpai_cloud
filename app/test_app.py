import pytest
from app import app

@pytest.fixture
def client():
    app.config.update({"TESTING": True})
    with app.test_client() as client:
        yield client

def test_hello_route(client):
    response = client.get("/")
    assert response.status_code == 200
    assert b"hello Prodpai Cloud" in response.data