from __future__ import annotations

from datetime import datetime, timezone
from typing import Annotated

from fastapi import (
    BackgroundTasks,
    Depends,
    FastAPI,
    Header,
    HTTPException,
    Request,
    Response,
    status,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from .ledger import DomainError, PaperLedger
from .notifications import TelegramNotifier
from .models import (
    AccountResponse,
    CancelResponse,
    ClosePositionResponse,
    HealthResponse,
    JournalResponse,
    LoginRequest,
    Order,
    OrderIntent,
    PaperOrderRequest,
    PaperOrderResponse,
    Position,
    RiskConfig,
    RiskDecision,
    SessionResponse,
    SystemResponse,
    TelegramDelivery,
    TelegramStatus,
)
from .security import (
    LoginLimiter,
    issue_session,
    origin_is_allowed,
    require_csrf,
    require_session,
    verify_passphrase,
)
from .settings import Settings


IdempotencyKey = Annotated[
    str,
    Header(alias="Idempotency-Key", min_length=8, max_length=128),
]


def create_app(settings: Settings | None = None) -> FastAPI:
    resolved = settings or Settings.from_env()
    app = FastAPI(
        title="Gulshan Toppo Trading Command API",
        version="0.1.0",
        docs_url=None if resolved.is_production else "/docs",
        redoc_url=None,
    )
    app.state.settings = resolved
    app.state.ledger = PaperLedger(resolved.state_file)
    app.state.telegram = TelegramNotifier(
        resolved.telegram_bot_token,
        resolved.telegram_chat_id,
    )
    app.state.login_limiter = LoginLimiter(
        resolved.login_max_attempts,
        resolved.login_window_seconds,
    )
    app.state.started_at = datetime.now(timezone.utc)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(resolved.allowed_origins),
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "OPTIONS"],
        allow_headers=["Content-Type", "X-CSRF-Token", "Idempotency-Key"],
    )

    @app.middleware("http")
    async def enforce_origin(request: Request, call_next):
        if request.method in {
            "POST",
            "PUT",
            "PATCH",
            "DELETE",
        } and request.url.path.startswith("/api/"):
            if not origin_is_allowed(resolved, request.headers.get("origin")):
                return JSONResponse(
                    status_code=status.HTTP_403_FORBIDDEN,
                    content={"detail": "Request origin is not allowed."},
                )
        return await call_next(request)

    @app.exception_handler(DomainError)
    async def domain_error_handler(_: Request, exc: DomainError) -> JSONResponse:
        content: dict = {"detail": exc.message}
        if exc.checks:
            content["checks"] = exc.checks
        return JSONResponse(status_code=exc.status_code, content=content)

    @app.get("/api/health", response_model=HealthResponse)
    def health(request: Request) -> HealthResponse:
        return HealthResponse(
            service="gulshan-command-api",
            status="ok",
            api_version="0.1.0",
            mode="PAPER",
            live_execution="DISABLED",
            broker_connected=False,
            engine_connected=False,
            data_mode="DEMO_FIXTURE",
            auth="enabled",
            telegram_configured=request.app.state.telegram.configured,
            time=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        )

    @app.post("/api/auth/login", response_model=SessionResponse)
    def login(
        payload: LoginRequest, request: Request, response: Response
    ) -> SessionResponse:
        key = request.client.host if request.client else "unknown"
        retry_after = request.app.state.login_limiter.retry_after(key)
        if retry_after is not None:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many login attempts. Try again later.",
                headers={"Retry-After": str(retry_after)},
            )
        if not verify_passphrase(payload.passphrase, resolved.passphrase_hash):
            request.app.state.login_limiter.fail(key)
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Invalid passphrase.",
            )
        request.app.state.login_limiter.reset(key)
        token, csrf_token, expires_at = issue_session(resolved)
        response.set_cookie(
            key=resolved.cookie_name,
            value=token,
            max_age=resolved.session_ttl_minutes * 60,
            httponly=True,
            secure=resolved.cookie_secure,
            samesite="strict",
            path="/api",
        )
        return SessionResponse(csrf_token=csrf_token, expires_at=expires_at)

    @app.get("/api/auth/session", response_model=SessionResponse)
    def session(
        request: Request, data: dict = Depends(require_session)
    ) -> SessionResponse:
        return SessionResponse(
            csrf_token=data["csrf"],
            expires_at=int(data["exp"]),
        )

    @app.post("/api/auth/logout", response_model=SessionResponse)
    def logout(
        response: Response,
        _: dict = Depends(require_csrf),
    ) -> SessionResponse:
        response.delete_cookie(
            key=resolved.cookie_name,
            path="/api",
            httponly=True,
            secure=resolved.cookie_secure,
            samesite="strict",
        )
        return SessionResponse(authenticated=False, csrf_token=None, expires_at=None)

    @app.get("/api/system", response_model=SystemResponse)
    def system(
        request: Request,
        _: dict = Depends(require_session),
    ) -> SystemResponse:
        return SystemResponse(
            environment=resolved.environment,
            mode="PAPER",
            live_execution="DISABLED",
            broker_connected=False,
            engine_connected=False,
            paper_state_persisted=resolved.state_file is not None,
            session_ttl_minutes=resolved.session_ttl_minutes,
            allowed_origins=list(resolved.allowed_origins),
            telegram_configured=request.app.state.telegram.configured,
        )

    @app.get("/api/notifications/telegram", response_model=TelegramStatus)
    def telegram_status(
        request: Request,
        _: dict = Depends(require_session),
    ) -> TelegramStatus:
        notifier: TelegramNotifier = request.app.state.telegram
        return TelegramStatus(
            configured=notifier.configured,
            chat_id=notifier.masked_chat_id,
        )

    @app.post("/api/notifications/telegram/test", response_model=TelegramDelivery)
    async def telegram_test(
        request: Request,
        _: dict = Depends(require_csrf),
    ) -> TelegramDelivery:
        notifier: TelegramNotifier = request.app.state.telegram
        if not notifier.configured:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Telegram is not configured on the server.",
            )
        result = await notifier.send(
            "Gulshan Command Center: Telegram alert test. Paper mode only."
        )
        if not result.delivered:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=result.detail,
            )
        return TelegramDelivery(delivered=True, detail=result.detail)

    @app.get("/api/account", response_model=AccountResponse)
    def account(
        request: Request, _: dict = Depends(require_session)
    ) -> AccountResponse:
        return request.app.state.ledger.account()

    @app.get("/api/risk", response_model=RiskConfig)
    def get_risk(request: Request, _: dict = Depends(require_session)) -> RiskConfig:
        return request.app.state.ledger.risk_config()

    @app.put("/api/risk", response_model=RiskConfig)
    def put_risk(
        config: RiskConfig,
        request: Request,
        _: dict = Depends(require_csrf),
    ) -> RiskConfig:
        return request.app.state.ledger.update_risk(config)

    @app.post("/api/risk/evaluate", response_model=RiskDecision)
    def evaluate(
        intent: OrderIntent,
        request: Request,
        _: dict = Depends(require_csrf),
    ) -> RiskDecision:
        return request.app.state.ledger.evaluate(intent)

    @app.get("/api/orders", response_model=list[Order])
    def orders(request: Request, _: dict = Depends(require_session)) -> list[Order]:
        return request.app.state.ledger.orders()

    @app.post("/api/orders/paper", response_model=PaperOrderResponse)
    def place_paper_order(
        payload: PaperOrderRequest,
        request: Request,
        background_tasks: BackgroundTasks,
        idempotency_key: IdempotencyKey,
        _: dict = Depends(require_csrf),
    ) -> PaperOrderResponse:
        response = request.app.state.ledger.place_order(payload, idempotency_key)
        notifier: TelegramNotifier = request.app.state.telegram
        if not response.replayed and notifier.configured:
            background_tasks.add_task(
                notifier.send,
                f"PAPER FILL: {response.order.symbol} {response.order.qty} shares @ Rs {response.order.avg_fill:,.2f}",
            )
        return response

    @app.post("/api/orders/{order_id}/cancel", response_model=CancelResponse)
    def cancel_order(
        order_id: str,
        request: Request,
        _: dict = Depends(require_csrf),
    ) -> CancelResponse:
        return CancelResponse(order=request.app.state.ledger.cancel_order(order_id))

    @app.get("/api/positions", response_model=list[Position])
    def positions(
        request: Request, _: dict = Depends(require_session)
    ) -> list[Position]:
        return request.app.state.ledger.positions()

    @app.post(
        "/api/positions/{position_id}/close", response_model=ClosePositionResponse
    )
    def close_position(
        position_id: str,
        request: Request,
        background_tasks: BackgroundTasks,
        _: dict = Depends(require_csrf),
    ) -> ClosePositionResponse:
        response = request.app.state.ledger.close_position(position_id)
        notifier: TelegramNotifier = request.app.state.telegram
        if notifier.configured:
            background_tasks.add_task(
                notifier.send,
                f"PAPER CLOSE: {response.trade.symbol} P&L Rs {response.trade.pnl:,.2f}",
            )
        return response

    @app.get("/api/journal", response_model=JournalResponse)
    def journal(
        request: Request, _: dict = Depends(require_session)
    ) -> JournalResponse:
        return JournalResponse(trades=request.app.state.ledger.journal())

    return app


app = create_app()
