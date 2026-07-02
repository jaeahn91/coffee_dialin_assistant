// QR 토큰 규격(보안 리뷰 결정): crypto 기반 base64url 21자(≈126비트).
// 열거 불가가 1차 방어 — 규격을 바꾸면 발급분과 검증 로직이 함께 움직여야 하므로 여기 한 곳에서만 정의한다.
import { randomBytes } from "node:crypto";

export const newQrCode = () => randomBytes(16).toString("base64url").slice(0, 21);
