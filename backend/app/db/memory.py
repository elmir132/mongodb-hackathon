from copy import deepcopy
from datetime import datetime, timezone
from threading import RLock
from uuid import uuid4


class MemoryRepository:
    """Process-local development storage. Contents disappear on restart."""

    def __init__(self) -> None:
        self._lock = RLock()
        self._facts: list[dict] = []
        self._overrides: dict[str, dict] = {}
        self._events: list[dict] = []
        self._state = {
            "revision": 0,
            "value": {},
            "updated_at": datetime.now(timezone.utc),
        }

    def initialize(self) -> None:
        return None

    def close(self) -> None:
        return None

    def health_check(self) -> bool:
        return True

    def add_fact(self, fact: dict) -> dict:
        with self._lock:
            record = {**deepcopy(fact), "id": str(uuid4()), "created_at": self._now()}
            self._facts.append(record)
            self._append_event("fact.created", {"fact": record})
            return deepcopy(record)

    def list_facts(self) -> list[dict]:
        with self._lock:
            return deepcopy(self._facts)

    def get_state(self) -> dict:
        with self._lock:
            return {
                **deepcopy(self._state),
                "overrides": {key: item["value"] for key, item in self._overrides.items()},
            }

    def save_state(self, value: dict) -> dict:
        with self._lock:
            self._state = {
                "revision": self._state["revision"] + 1,
                "value": deepcopy(value),
                "updated_at": self._now(),
            }
            self._append_event("state.resolved", {"revision": self._state["revision"]})
            return self.get_state()

    def set_override(self, key: str, value: object, reason: str) -> dict:
        with self._lock:
            record = {
                "key": key,
                "value": deepcopy(value),
                "reason": reason,
                "created_at": self._now(),
            }
            self._overrides[key] = record
            self._append_event("override.set", {"key": key, "value": value, "reason": reason})
            return deepcopy(record)

    def list_events(self, after_id: str | None = None, limit: int = 100) -> list[dict]:
        with self._lock:
            start = 0
            if after_id is not None:
                for index, event in enumerate(self._events):
                    if event["id"] == after_id:
                        start = index + 1
                        break
                else:
                    return []
            return deepcopy(self._events[start : start + limit])

    def _append_event(self, kind: str, data: dict) -> None:
        self._events.append({
            "id": str(len(self._events) + 1),
            "kind": kind,
            "data": deepcopy(data),
            "created_at": self._now(),
        })

    @staticmethod
    def _now() -> datetime:
        return datetime.now(timezone.utc)
