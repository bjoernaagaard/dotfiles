"""Minimal inventory request handler used by benchmark fixtures."""

INVENTORY = {"widget": 12, "gadget": 4}


def handle_request(path: str):
    if path == "/inventory":
        return 200, INVENTORY.copy()
    return 404, {"error": "not found"}
