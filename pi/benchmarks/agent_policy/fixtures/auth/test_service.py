import unittest

from service import handle_request


class ServiceTests(unittest.TestCase):
    def test_inventory(self):
        status, body = handle_request("/inventory")
        self.assertEqual(status, 200)
        self.assertEqual(body["widget"], 12)


if __name__ == "__main__":
    unittest.main()
