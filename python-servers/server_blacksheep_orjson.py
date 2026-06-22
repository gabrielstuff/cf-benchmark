"""BlackSheep benchmark server — optimized with orjson for JSON serialization.

Changes from baseline:
  - orjson.dumps() for JSON responses (faster than stdlib json)
  - Raw Response + Content construction to skip BlackSheep's json helper
  - Each endpoint still constructs and serializes per-request (no pre-serialized statics)

Endpoints:
  GET  /plaintext         -> "Hello, World!"
  GET  /json              -> {"message": "Hello, World!"}
  GET  /user/:id          -> {"id": <id>, "name": "User <id>"}
  POST /validate          -> echo validated body {"name": str, "age": int}
"""

import orjson
from blacksheep import Application, Content, Request, Response
from blacksheep.server.responses import text as text_resp

app = Application(show_error_details=False)

HELLO = "Hello, World!"
CT_JSON = b"application/json"


def json_bytes_response(data: dict, status: int = 200) -> Response:
    """Build a Response from orjson-serialized bytes."""
    return Response(status, content=Content(CT_JSON, orjson.dumps(data)))


@app.router.get("/plaintext")
async def plaintext():
    return text_resp(HELLO)


@app.router.get("/json")
async def json_endpoint() -> Response:
    return json_bytes_response({"message": HELLO})


@app.router.get("/user/{user_id}")
async def get_user(user_id: str) -> Response:
    return json_bytes_response({"id": user_id, "name": f"User {user_id}"})


@app.router.post("/validate")
async def validate(request: Request) -> Response:
    body = orjson.loads(await request.read())
    name = body.get("name")
    age = body.get("age")

    if not isinstance(name, str) or not name:
        return json_bytes_response({"error": "name must be a non-empty string"}, 400)
    if not isinstance(age, int) or age < 0 or age > 150:
        return json_bytes_response(
            {"error": "age must be an integer between 0 and 150"}, 400
        )

    return json_bytes_response({"name": name, "age": age, "valid": True})
