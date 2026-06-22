"""FastAPI benchmark server.

Endpoints:
  GET  /plaintext         -> "Hello, World!"
  GET  /json              -> {"message": "Hello, World!"}
  GET  /user/:id          -> {"id": <id>, "name": "User <id>"}
  POST /validate          -> echo validated body {"name": str, "age": int}
"""

from fastapi import FastAPI
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field

app = FastAPI()

HELLO = "Hello, World!"


class UserInput(BaseModel):
    name: str = Field(min_length=1)
    age: int = Field(ge=0, le=150)


@app.get("/plaintext")
async def plaintext() -> PlainTextResponse:
    return PlainTextResponse(HELLO)


@app.get("/json")
async def json_endpoint() -> dict:
    return {"message": HELLO}


@app.get("/user/{user_id}")
async def get_user(user_id: str) -> dict:
    return {"id": user_id, "name": f"User {user_id}"}


@app.post("/validate")
async def validate(body: UserInput) -> dict:
    return {"name": body.name, "age": body.age, "valid": True}
