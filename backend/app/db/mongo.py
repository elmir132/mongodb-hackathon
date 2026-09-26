from datetime import datetime, timezone
from uuid import uuid4

from bson import ObjectId
from pymongo import MongoClient, ReturnDocument

from app.db.collections import Collections, ensure_indexes, get_collections


class MongoRepository:
    """Atlas persistence; each mutation and its event share a transaction."""

    def __init__(self, uri: str, database_name: str) -> None:
        self._client = MongoClient(uri, serverSelectionTimeoutMS=5000)
        self._database = self._client[database_name]
        self._collections: Collections = get_collections(self._database)

    def initialize(self) -> None:
        self._client.admin.command("ping")
        ensure_indexes(self._collections)

    def close(self) -> None:
        self._client.close()

    def health_check(self) -> bool:
        self._client.admin.command("ping")
        return True

    def add_fact(self, fact: dict) -> dict:
        record = {**fact, "_id": str(uuid4()), "created_at": self._now()}
        with self._client.start_session() as session:
            with session.start_transaction():
                self._collections.facts.insert_one(record, session=session)
                self._insert_event("fact.created", {"fact": self._clean(record)}, session)
        return self._clean(record)

    def list_facts(self) -> list[dict]:
        return [self._clean(item) for item in self._collections.facts.find().sort("created_at", -1)]

    def get_state(self) -> dict:
        state = self._collections.states.find_one({"_id": "current"}) or {
            "revision": 0,
            "value": {},
            "updated_at": self._now(),
        }
        overrides = {
            item["key"]: item["value"]
            for item in self._collections.overrides.find({}, {"key": 1, "value": 1})
        }
        return {"revision": state["revision"], "value": state["value"],
                "overrides": overrides, "updated_at": state["updated_at"]}

    def save_state(self, value: dict) -> dict:
        with self._client.start_session() as session:
            with session.start_transaction():
                state = self._collections.states.find_one_and_update(
                    {"_id": "current"},
                    {"$set": {"value": value, "updated_at": self._now()}, "$inc": {"revision": 1}},
                    upsert=True,
                    return_document=ReturnDocument.AFTER,
                    session=session,
                )
                self._insert_event("state.resolved", {"revision": state["revision"]}, session)
        return self.get_state()

    def set_override(self, key: str, value: object, reason: str) -> dict:
        now = self._now()
        record = {"key": key, "value": value, "reason": reason, "created_at": now}
        with self._client.start_session() as session:
            with session.start_transaction():
                self._collections.overrides.replace_one({"key": key}, record, upsert=True, session=session)
                self._insert_event("override.set", {"key": key, "value": value, "reason": reason}, session)
        return record

    def list_events(self, after_id: str | None = None, limit: int = 100) -> list[dict]:
        query = {"_id": {"$gt": ObjectId(after_id)}} if after_id else {}
        events = self._collections.events.find(query).sort("_id", 1).limit(limit)
        return [self._clean(item) for item in events]

    def _insert_event(self, kind: str, data: dict, session) -> None:
        self._collections.events.insert_one(
            {"kind": kind, "data": data, "created_at": self._now()}, session=session
        )

    @staticmethod
    def _clean(document: dict) -> dict:
        result = dict(document)
        identifier = result.pop("_id", None)
        if identifier is not None:
            result["id"] = str(identifier)
        return result

    @staticmethod
    def _now() -> datetime:
        return datetime.now(timezone.utc)
