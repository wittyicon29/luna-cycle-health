"""Client IP for rate limiting, honouring X-Forwarded-For only from trusted proxies."""
import ipaddress
from functools import lru_cache
from typing import Optional, Tuple, Union

from starlette.requests import Request

from .config import IPNetwork, parse_networks, settings

IPAddress = Union[ipaddress.IPv4Address, ipaddress.IPv6Address]

# Same fallback as slowapi.util.get_remote_address when the ASGI server gives no peer.
NO_PEER = "127.0.0.1"


@lru_cache(maxsize=8)
def _networks(raw: str) -> Tuple[IPNetwork, ...]:
    return tuple(parse_networks(raw))


def _parse_ip(value: str) -> Optional[IPAddress]:
    """Parse one address, stripping [brackets] and :port; None for anything invalid."""
    value = value.strip()
    if not value:
        return None
    if value.startswith("["):
        end = value.find("]")
        if end == -1:
            return None
        rest = value[end + 1:]
        if rest and not (rest.startswith(":") and rest[1:].isdigit()):
            return None
        value = value[1:end]
    elif value.count(":") == 1:  # IPv4 with a port
        host, port = value.split(":")
        if not port.isdigit():
            return None
        value = host
    try:
        ip = ipaddress.ip_address(value)
    except ValueError:
        return None
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        return ip.ipv4_mapped
    return ip


def _is_trusted(ip: IPAddress, networks: Tuple[IPNetwork, ...]) -> bool:
    return any(ip in net for net in networks)


def get_client_ip(request: Request) -> str:
    """Return the address the rate limiter keys on.

    The direct peer is used unless it is a trusted proxy; then X-Forwarded-For is walked
    right to left, skipping trusted hops, and the first untrusted address is returned.
    Anything unparsable on the way falls back to the peer, so a spoofed or malformed
    header can never pick an arbitrary key.
    """
    peer_host = request.client.host if request.client and request.client.host else NO_PEER
    peer = _parse_ip(peer_host)
    if peer is None:
        return peer_host
    networks = _networks(settings.TRUSTED_PROXY_IPS)
    if not networks or not _is_trusted(peer, networks):
        return str(peer)
    forwarded = ",".join(request.headers.getlist("x-forwarded-for"))
    for hop in reversed(forwarded.split(",")):
        ip = _parse_ip(hop)
        if ip is None:
            return str(peer)
        if not _is_trusted(ip, networks):
            return str(ip)
    return str(peer)
