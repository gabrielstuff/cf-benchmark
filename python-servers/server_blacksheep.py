"""BlackSheep benchmark server.

Endpoints:
  GET  /plaintext         -> "Hello, World!"
  GET  /json              -> {"message": "Hello, World!"}
  GET  /user/:id          -> {"id": <id>, "name": "User <id>"}
  POST /validate          -> echo validated body {"name": str, "age": int}
"""

from blacksheep import Application, Request
from blacksheep.server.responses import json as json_resp
from blacksheep.server.responses import text as text_resp

app = Application()

HELLO = "Hello, World!"


@app.router.get("/plaintext")
async def plaintext():
    return text_resp(HELLO)


@app.router.get("/json")
async def json_endpoint():
    return json_resp({"message": HELLO})


@app.router.get("/user/{user_id}")
async def get_user(user_id: str):
    return json_resp({"id": user_id, "name": f"User {user_id}"})


@app.router.post("/validate")
async def validate(request: Request):
    body = await request.json()
    name = body.get("name")
    age = body.get("age")

    if not isinstance(name, str) or not name:
        return json_resp({"error": "name must be a non-empty string"}, status=400)
    if not isinstance(age, int) or age < 0 or age > 150:
        return json_resp(
            {"error": "age must be an integer between 0 and 150"}, status=400
        )

    return json_resp({"name": name, "age": age, "valid": True})
