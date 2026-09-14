import unittest
import threading
import urllib.error
from http.server import BaseHTTPRequestHandler, HTTPServer
from station_response import compare_cohort, query


class FixedCohortTest(unittest.TestCase):
    def test_keeps_nonreturners_and_freezes_pre_level(self):
        rows = [
            dict(dt='2026-08-01', duid=1, ps_level='HIGH', label_match_status='MATCHED', vehicle_type='private', orders=2),
            dict(dt='2026-08-01', duid=2, ps_level='HIGH', label_match_status='MATCHED', vehicle_type='private', orders=2),
            dict(dt='2026-08-02', duid=1, ps_level=None, label_match_status='NO_LABEL', vehicle_type=None, orders=1),
            dict(dt='2026-08-02', duid=3, ps_level='HIGH', label_match_status='MATCHED', vehicle_type='private', orders=10),
        ]
        band = compare_cohort(rows, '2026-08-02', 1)['HIGH']
        self.assertEqual(band, {'users': 2, 'returned': 1, 'pre_orders': 4, 'post_orders': 1, 'return_rate': 0.5, 'pre_orders_per_user': 2, 'post_orders_per_user': 0.5, 'order_change': -0.75})

    def test_conflicting_pre_label_is_rejected(self):
        rows = [dict(dt='2026-08-01', duid=1, ps_level=level, label_match_status='MATCHED', vehicle_type='private', orders=1) for level in ['HIGH', 'LOW']]
        with self.assertRaises(ValueError):
            compare_cohort(rows, '2026-08-02', 1)

    def test_uses_exact_equal_calendar_windows(self):
        rows = [dict(dt=date, duid=1, ps_level='HIGH', label_match_status='MATCHED', vehicle_type='private', orders=1) for date in ['2026-07-31', '2026-08-01', '2026-08-07', '2026-08-08', '2026-08-14', '2026-08-15']]
        band = compare_cohort(rows, '2026-08-08', 7)['HIGH']
        self.assertEqual((band['pre_orders'], band['post_orders']), (2, 2))

    def test_does_not_forward_headers_on_redirect(self):
        reached = []

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                self.send_response(302)
                self.send_header('Location', '/sink')
                self.end_headers()

            def do_GET(self):
                reached.append(True)
                self.send_response(200)
                self.end_headers()

            def log_message(self, *_args):
                pass

        server = HTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with self.assertRaises(urllib.error.HTTPError):
                query(f'http://127.0.0.1:{server.server_port}/api', {'sign': 'test-only'}, ['dt'])
            self.assertEqual(reached, [])
        finally:
            server.shutdown()
            server.server_close()
            thread.join()


if __name__ == '__main__':
    unittest.main()
