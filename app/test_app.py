import pytest
from app import app

AWS_SECRET_KEY = "AKIAIOSFODNN7EXAMPLE1234567890" #key

@pytest.fixture
def client():
    app.config.update({"TESTING": True})
    with app.test_client() as client:
        yield client

# Command Injection
@app.route("/ping")
def ping():
    host = request.args.get("host")
    result = os.system("ping -c 1 " + host)
    return str(result)

def test_hello_route(client):
    response = client.get("/")
    assert response.status_code == 200
    assert b"hello Prodpai Cloud" in response.data