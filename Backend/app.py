import os
import secrets
from pathlib import Path

import psycopg
from dotenv import load_dotenv
from flask import Flask, jsonify, request
from flask_cors import CORS
from psycopg.errors import UniqueViolation
from psycopg.rows import dict_row
from werkzeug.security import check_password_hash, generate_password_hash

load_dotenv(Path(__file__).with_name(".env"))

from trips import trips

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 16 * 1024
app.register_blueprint(trips)
CORS(app, origins=["http://localhost:5173", "http://127.0.0.1:5173"])

DATABASE_URL = os.environ.get("DATABASE_URL", "postgresql:///locallens")
SCHEMA_PATH = Path(__file__).with_name("schema.sql")
DEMO_EMAIL = "alex@locallens.app"
DEMO_PASSWORD = "neighborhood"


def connect():
    return psycopg.connect(DATABASE_URL, row_factory=dict_row, connect_timeout=3)


def init_db():
    statements = [
        statement.strip()
        for statement in SCHEMA_PATH.read_text().split(";")
        if statement.strip()
    ]
    with connect() as conn:
        for statement in statements:
            conn.execute(statement)
        existing = conn.execute(
            "SELECT id FROM accounts WHERE email = %s",
            (DEMO_EMAIL,),
        ).fetchone()
        if existing is None:
            conn.execute(
                """
                INSERT INTO accounts (name, email, password_hash)
                VALUES (%s, %s, %s)
                """,
                ("Alex Rivera", DEMO_EMAIL, generate_password_hash(DEMO_PASSWORD)),
            )


def public_user(user):
    return {"name": user["name"], "email": user["email"]}


def bearer_token():
    header = request.headers.get("Authorization", "")
    scheme, _, token = header.partition(" ")
    if scheme.lower() != "bearer" or not token:
        return None
    return token


def account_for_token(conn, token):
    if not token:
        return None
    return conn.execute(
        """
        SELECT accounts.id, accounts.name, accounts.email
        FROM sessions
        JOIN accounts ON accounts.id = sessions.account_id
        WHERE sessions.token = %s
        """,
        (token,),
    ).fetchone()


@app.route("/")
def home():
    return jsonify({
        "message": "Weatherway trip planning API is running."
    })


@app.route("/api/health")
def health():
    return jsonify({"status": "ok", "planner": "available", "database": "optional; used by account endpoints only"})


@app.post("/api/auth/login")
def login():
    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""

    try:
        with connect() as conn:
            user = conn.execute(
                """
                SELECT id, name, email, password_hash
                FROM accounts
                WHERE email = %s
                """,
                (email,),
            ).fetchone()
            if not user or not check_password_hash(user["password_hash"], password):
                return jsonify({"error": "Email or password is incorrect."}), 401

            token = secrets.token_urlsafe(32)
            conn.execute(
                "INSERT INTO sessions (token, account_id) VALUES (%s, %s)",
                (token, user["id"]),
            )
    except psycopg.Error:
        return jsonify({"error": "Account storage is unavailable."}), 503

    return jsonify({"token": token, "user": public_user(user)})


@app.post("/api/auth/signup")
def signup():
    data = request.get_json(silent=True) or {}
    name = (data.get("name") or "").strip()
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""

    if len(name) < 2:
        return jsonify({"error": "Enter the name you want on your profile."}), 400
    if "@" not in email or "." not in email.split("@")[-1]:
        return jsonify({"error": "Enter a valid email address."}), 400
    if len(password) < 8:
        return jsonify({"error": "Use at least 8 characters."}), 400

    try:
        with connect() as conn:
            try:
                user = conn.execute(
                    """
                    INSERT INTO accounts (name, email, password_hash)
                    VALUES (%s, %s, %s)
                    RETURNING id, name, email
                    """,
                    (name, email, generate_password_hash(password)),
                ).fetchone()
            except UniqueViolation:
                conn.rollback()
                return jsonify({"error": "An account with that email already exists."}), 409

            token = secrets.token_urlsafe(32)
            conn.execute(
                "INSERT INTO sessions (token, account_id) VALUES (%s, %s)",
                (token, user["id"]),
            )
    except psycopg.Error:
        return jsonify({"error": "Account storage is unavailable."}), 503

    return jsonify({"token": token, "user": public_user(user)}), 201


@app.get("/api/auth/me")
def me():
    try:
        with connect() as conn:
            user = account_for_token(conn, bearer_token())
    except psycopg.Error:
        return jsonify({"error": "Account storage is unavailable."}), 503

    if not user:
        return jsonify({"error": "Sign in required."}), 401
    return jsonify({"user": public_user(user)})


@app.post("/api/auth/logout")
def logout():
    token = bearer_token()
    if token:
        try:
            with connect() as conn:
                conn.execute("DELETE FROM sessions WHERE token = %s", (token,))
        except psycopg.Error:
            return jsonify({"error": "Account storage is unavailable."}), 503
    return jsonify({"ok": True})


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser()
    parser.add_argument("--init-db", action="store_true", help="Initialize optional account tables and exit")
    args = parser.parse_args()
    if args.init_db:
        init_db()
        print("Account database initialized.")
    else:
        app.run(debug=os.environ.get("FLASK_DEBUG") == "1", host="127.0.0.1", port=5001, use_reloader=False)
