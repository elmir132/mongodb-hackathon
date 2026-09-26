from dataclasses import dataclass

from pymongo.collection import Collection


@dataclass(frozen=True)
class Collections:
    facts: Collection
    states: Collection
    overrides: Collection
    events: Collection


def get_collections(database) -> Collections:
    return Collections(
        facts=database["facts"],
        states=database["states"],
        overrides=database["overrides"],
        events=database["events"],
    )


def ensure_indexes(collections: Collections) -> None:
    collections.facts.create_index([("subject", 1), ("predicate", 1)])
    collections.facts.create_index([("created_at", -1)])
    collections.overrides.create_index("key", unique=True)
    collections.events.create_index([("created_at", 1)])
