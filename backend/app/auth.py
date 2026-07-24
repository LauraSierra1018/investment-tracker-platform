from dataclasses import dataclass

import httpx

from fastapi import (
    Header,
    HTTPException,
    status,
)

from .config import settings


@dataclass
class AuthUser:
    id: str
    email: str | None = None


async def get_current_user(
    authorization: str | None = Header(
        default=None
    ),
) -> AuthUser:
    """
    Valida el access token de Supabase y devuelve
    el usuario autenticado.

    Watchlist y portfolio usarán esta dependencia.
    """

    if not authorization:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Debes iniciar sesión.",
        )

    scheme, _, token = authorization.partition(" ")

    if (
        scheme.lower() != "bearer"
        or not token
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token de autenticación inválido.",
        )

    if (
        not settings.supabase_url
        or not settings.supabase_publishable_key
    ):
        raise HTTPException(
            status_code=500,
            detail=(
                "Supabase no está configurado "
                "en el backend."
            ),
        )

    url = (
        f"{settings.supabase_url.rstrip('/')}"
        "/auth/v1/user"
    )

    headers = {
        "apikey": (
            settings.supabase_publishable_key
        ),
        "Authorization": f"Bearer {token}",
    }

    try:
        async with httpx.AsyncClient(
            timeout=10.0
        ) as client:
            response = await client.get(
                url,
                headers=headers,
            )

    except httpx.HTTPError:
        raise HTTPException(
            status_code=502,
            detail=(
                "No fue posible validar "
                "la sesión con Supabase."
            ),
        )

    if response.status_code != 200:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=(
                "La sesión expiró o no es válida. "
                "Inicia sesión nuevamente."
            ),
        )

    payload = response.json()

    user_id = payload.get("id")

    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Usuario inválido.",
        )

    return AuthUser(
        id=user_id,
        email=payload.get("email"),
    )