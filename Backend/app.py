
from flask import Flask, jsonify
from flask_cors import CORS

app = Flask(__name__)

# Allow requests from your Vite development server
CORS(app, origins=["http://localhost:5173"])

@app.route("/")
def home():
    return jsonify({
        "message": "LocalLens API is running!"
    })

@app.route("/api/health")
def health():
    return jsonify({
        "status": "ok"
    })

if __name__ == "__main__":
    app.run(debug=True, port=5000)
