import os
import secrets
from pathlib import Path

import psycopg
from dotenv import load_dotenv
from flask import Flask, jsonify, request
from flask_cors import CORS
from psycopg.errors import UniqueViolation
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb
from werkzeug.security import check_password_hash, generate_password_hash

load_dotenv(Path(__file__).with_name(".env"))

from trips import trips, selected_analysis
from corridor import TripError
from providers import ProviderError
from vehicles import epa_vehicle, validate_vehicle, vehicle_options
from journey import request_slot, run_journey, validate_question
from openrouter_client import JourneyError, configured, model_name
from retrieval import knowledge

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 16 * 1024
app.register_blueprint(trips)
CORS(app, origins=["http://localhost:5173", "http://127.0.0.1:5173"])

DATABASE_URL = os.environ.get(
    "DATABASE_URL",
    "postgresql://weatherway:weatherway@localhost:5433/weatherway"
)
SCHEMA_PATH = Path(__file__).with_name("schema.sql")
DEMO_EMAIL = "alex@weatherway.app"
LEGACY_DEMO_EMAIL = "alex@locallens.app"
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
        for email in (DEMO_EMAIL, LEGACY_DEMO_EMAIL):
            existing = conn.execute(
                "SELECT id FROM accounts WHERE email = %s",
                (email,),
            ).fetchone()
            if existing is None:
                conn.execute(
                    """
                    INSERT INTO accounts (name, email, password_hash)
                    VALUES (%s, %s, %s)
                    """,
                    ("Alex Rivera", email, generate_password_hash(DEMO_PASSWORD)),
                )


def ensure_db_ready():
    """Ensure database schema and seed accounts exist if postgres is running."""
    try:
        init_db()
    except Exception:
        # DB might not be up yet; endpoints handle connection errors gracefully
        pass



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
    db_status = "unavailable"
    try:
        with connect() as conn:
            conn.execute("SELECT 1")
            db_status = "connected"
    except Exception:
        db_status = "unavailable; ensure postgres docker is running"
    return jsonify({
        "status": "ok",
        "planner": "available",
        "database": db_status
    })


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


@app.get("/api/vehicles/options")
def vehicle_lookup():
    try:
        year = request.args.get("year", "")
        if not year.isdigit():
            raise TripError("Enter a model year.")
        return jsonify({"options": vehicle_options(int(year), request.args.get("make"), request.args.get("model"))})
    except TripError as error:
        return jsonify({"error": str(error)}), 400
    except ProviderError as error:
        return jsonify({"error": str(error)}), error.status


@app.get("/api/vehicles/estimate/<vehicle_id>")
def vehicle_estimate(vehicle_id):
    try:
        return jsonify({"vehicle": epa_vehicle(vehicle_id)})
    except TripError as error:
        return jsonify({"error": str(error)}), 400
    except ProviderError as error:
        return jsonify({"error": str(error)}), error.status


@app.route("/api/account/vehicle", methods=["GET", "PUT", "DELETE"])
def account_vehicle():
    if not bearer_token():
        return jsonify({"error": "Sign in to save your car."}), 401
    try:
        with connect() as conn:
            user = account_for_token(conn, bearer_token())
            if not user:
                return jsonify({"error": "Sign in required."}), 401
            if request.method == "PUT":
                profile = validate_vehicle(request.get_json(silent=True))
                conn.execute("""INSERT INTO account_vehicles (account_id, profile) VALUES (%s, %s)
                                ON CONFLICT (account_id) DO UPDATE SET profile = EXCLUDED.profile, updated_at = NOW()""",
                             (user["id"], Jsonb(profile)))
                return jsonify({"vehicle": profile})
            if request.method == "DELETE":
                conn.execute("DELETE FROM account_vehicles WHERE account_id = %s", (user["id"],))
                return jsonify({"ok": True})
            row = conn.execute("SELECT profile FROM account_vehicles WHERE account_id = %s", (user["id"],)).fetchone()
            return jsonify({"vehicle": row["profile"] if row else None})
    except TripError as error:
        return jsonify({"error": str(error)}), 400
    except ProviderError as error:
        return jsonify({"error": str(error)}), error.status
    except psycopg.Error:
        return jsonify({"error": "Vehicle storage is unavailable. Start PostgreSQL and run uv run python Backend/app.py --init-db."}), 503


@app.get('/api/journey/config')
def journey_config():
    return jsonify({'configured': configured(), 'model': model_name(), 'retrievalMethod': 'BM25',
                    'knowledgeVersion': knowledge()['version'], 'documents': len(knowledge()['documents'])})


@app.post('/api/journey/chat')
def journey_chat():
    if not bearer_token():
        return jsonify({'error': 'Sign in to use the journey agent.'}), 401
    try:
        question, starting_fuel, stop_budget, prefer_cheaper, fuel_grade = validate_question(request.get_json(silent=True))
        data = request.get_json()
        with connect() as conn:
            user = account_for_token(conn, bearer_token())
            if not user:
                return jsonify({'error': 'Sign in to use the journey agent.'}), 401
            row = conn.execute('SELECT profile FROM account_vehicles WHERE account_id = %s', (user['id'],)).fetchone()
            vehicle = row['profile'] if row else None
        if not configured():
            raise JourneyError('The journey agent is not configured on this server.', 503)
        selected = selected_analysis(data['analysisId'], data['candidateId'])
        if selected is None:
            return jsonify({'error': 'This analysis expired. Click Find Window to refresh forecasts.'}), 410
        snapshot, route, candidate = selected
        with request_slot(user['id']):
            result = run_journey(user['id'], data['analysisId'], snapshot, route, candidate, vehicle, question, starting_fuel, stop_budget, prefer_cheaper, fuel_grade)
        return jsonify(result | {'analysisId': data['analysisId'], 'candidateId': data['candidateId']})
    except TripError as error:
        return jsonify({'error': str(error)}), 400
    except JourneyError as error:
        return jsonify({'error': str(error)}), error.status
    except psycopg.Error:
        return jsonify({'error': 'Account storage is unavailable. The journey agent requires a signed-in account.'}), 503


ensure_db_ready()


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
