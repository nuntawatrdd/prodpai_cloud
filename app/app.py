from flask import Flask

app = Flask(__name__)

@app.route("/")
def hello():
    return "hello Prodpai Cloud Create EC2 by ASG #1"

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8080) # nosemgrep