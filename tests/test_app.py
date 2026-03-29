import unittest

from main import app


class AppSmokeTest(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()

    def test_index_returns_ok(self):
        response = self.client.get('/')
        self.assertEqual(response.status_code, 200)

    def test_health_returns_ok(self):
        response = self.client.get('/health')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {'status': 'ok'})


if __name__ == '__main__':
    unittest.main()
