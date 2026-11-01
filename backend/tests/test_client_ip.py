import ipaddress

import pytest
from starlette.requests import Request

from app.core import client_ip
from app.core.client_ip import get_client_ip


def make_request(peer, xff=None, extra_headers=()):
    headers = []
    if xff is not None:
        headers.append((b"x-forwarded-for", xff.encode()))
    headers.extend((name.encode(), value.encode()) for name, value in extra_headers)
    scope = {
        "type": "http",
        "method": "GET",
        "path": "/",
        "headers": headers,
        "client": (peer, 12345) if peer is not None else None,
    }
    return Request(scope)


@pytest.fixture
def trust(monkeypatch):
    def _trust(value):
        monkeypatch.setattr(client_ip.settings, "TRUSTED_PROXY_IPS", value)

    _trust("")
    return _trust


def test_untrusted_peer_ignores_spoofed_header(trust):
    trust("10.0.0.0/8")
    assert get_client_ip(make_request("203.0.113.9", "1.2.3.4")) == "203.0.113.9"


def test_empty_trusted_list_trusts_nobody(trust):
    assert get_client_ip(make_request("10.0.0.2", "1.2.3.4")) == "10.0.0.2"


def test_trusted_peer_single_client(trust):
    trust("10.0.0.2")
    assert get_client_ip(make_request("10.0.0.2", "1.2.3.4")) == "1.2.3.4"


def test_trusted_chain_returns_rightmost_untrusted(trust):
    trust("10.0.0.0/8")
    assert get_client_ip(make_request("10.0.0.3", "1.2.3.4, 10.0.0.2")) == "1.2.3.4"


def test_spoofed_left_entries_are_not_used(trust):
    trust("10.0.0.0/8")
    # The client prepended a fake address; the proxy appended the real one.
    assert get_client_ip(make_request("10.0.0.3", "9.9.9.9, 1.2.3.4")) == "1.2.3.4"


def test_all_hops_trusted_falls_back_to_peer(trust):
    trust("10.0.0.0/8")
    assert get_client_ip(make_request("10.0.0.3", "10.0.0.1, 10.0.0.2")) == "10.0.0.3"


def test_header_absent_returns_peer(trust):
    trust("10.0.0.0/8")
    assert get_client_ip(make_request("10.0.0.3")) == "10.0.0.3"


@pytest.mark.parametrize("xff", ["", "   ", "not-an-ip", "1.2.3.4, garbage", "300.1.1.1", "1.2.3.4:abc", "[::1", ",,"])
def test_garbage_falls_back_to_peer(trust, xff):
    trust("10.0.0.0/8")
    assert get_client_ip(make_request("10.0.0.3", xff)) == "10.0.0.3"


def test_ipv6_peer_and_client(trust):
    trust("fd00::/8")
    assert get_client_ip(make_request("fd00::1", "2001:db8::1")) == "2001:db8::1"


def test_ipv6_untrusted_peer_is_returned(trust):
    trust("10.0.0.0/8")
    assert get_client_ip(make_request("2001:db8::5", "1.2.3.4")) == "2001:db8::5"


def test_brackets_and_ports_are_stripped(trust):
    trust("10.0.0.0/8")
    assert get_client_ip(make_request("10.0.0.3", "[2001:db8::1]:4711")) == "2001:db8::1"
    assert get_client_ip(make_request("10.0.0.3", "[2001:db8::2]")) == "2001:db8::2"
    assert get_client_ip(make_request("10.0.0.3", "1.2.3.4:5678")) == "1.2.3.4"


def test_ipv6_is_normalised(trust):
    trust("10.0.0.0/8")
    assert get_client_ip(make_request("10.0.0.3", "2001:DB8:0:0::1")) == "2001:db8::1"


def test_ipv4_mapped_ipv6_matches_ipv4_networks(trust):
    trust("10.0.0.0/8")
    assert get_client_ip(make_request("::ffff:10.0.0.3", "1.2.3.4")) == "1.2.3.4"


def test_multiple_header_lines_are_joined_in_order(trust):
    trust("10.0.0.0/8")
    request = make_request("10.0.0.3", "9.9.9.9", extra_headers=[("x-forwarded-for", "1.2.3.4, 10.0.0.2")])
    assert get_client_ip(request) == "1.2.3.4"


def test_non_ip_peer_is_returned_unchanged(trust):
    trust("10.0.0.0/8")
    assert get_client_ip(make_request("testclient", "1.2.3.4")) == "testclient"


def test_missing_client_has_stable_fallback(trust):
    assert get_client_ip(make_request(None, "1.2.3.4")) == "127.0.0.1"


def test_trusted_proxies_setting_is_parsed(trust):
    trust(" 10.0.0.0/8, 192.168.1.5 ,::1,")
    assert client_ip.settings.trusted_proxies == [
        ipaddress.ip_network("10.0.0.0/8"),
        ipaddress.ip_network("192.168.1.5/32"),
        ipaddress.ip_network("::1/128"),
    ]
