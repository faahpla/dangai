"""AI-assisted review of ambiguous shot classifications.

For shots where the CLIP pipeline has low-to-mid confidence, we send the
keyframe plus a handful of candidate character references to a vision-LLM
(Gemini via NavyAI, or any OpenAI-compatible gateway) and ask it to pick
the best match. The result can override/confirm the CLIP assignment.

This module is intentionally self-contained — no Qt, no app state — so it
can be called from a worker thread or tested in isolation.
"""
from __future__ import annotations

import base64
import json
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import httpx


GEMINI_OPENAI_BASE = "https://generativelanguage.googleapis.com/v1beta/openai"

# Substrings that mark a 429 as "gone for the day" rather than "slow down".
# NavyAI: "You have exceeded your daily token limit. Usage resets at midnight UTC."
# Gemini: "You exceeded your current quota, please check your plan and billing"
_QUOTA_MARKERS = ("daily", "quota", "billing")


class QuotaExhaustedError(RuntimeError):
    """Daily/billing quota exhausted on this client — retrying is pointless
    until the provider resets. Callers should stop using the client."""


class NavyAIClient:
    """Minimal OpenAI-compatible client for NavyAI / any gateway that
    speaks the same schema. Supports image_url inline data URLs.

    Optionally takes a `fallback` (another NavyAIClient, typically pointing
    at Gemini's native OpenAI-compatible endpoint). If the primary POST
    fails after retries — 5xx, timeout, rate-limit — we hand the same
    content off to the fallback and return whatever it produces.
    """

    def __init__(
        self,
        api_key: str,
        base_url: str = "https://api.navy/v1",
        model: str = "gemini-2.5-flash",
        timeout: float = 60.0,
        fallback: "NavyAIClient | None" = None,
    ) -> None:
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.fallback = fallback
        # Set when the provider says the daily quota is gone; from then on
        # post_content skips this client and goes straight to the fallback.
        self.dead_reason: str | None = None
        self.client = httpx.Client(
            timeout=timeout,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
        )

    def close(self) -> None:
        self.client.close()
        if self.fallback is not None:
            self.fallback.close()

    @staticmethod
    def _data_url(img_bytes: bytes, mime: str = "image/jpeg") -> str:
        return f"data:{mime};base64,{base64.b64encode(img_bytes).decode('ascii')}"

    def _build_payload(
        self, content: list[dict], max_tokens: int = 300
    ) -> dict:
        return {
            "model": self.model,
            "messages": [{"role": "user", "content": content}],
            "temperature": 0.0,
            "max_tokens": max_tokens,
            "response_format": {"type": "json_object"},
        }

    def _extract_content_and_usage(
        self, data: dict
    ) -> tuple[str | None, dict]:
        """Unpack /chat/completions response into (raw_content, usage_dict)."""
        usage = data.get("usage") if isinstance(data, dict) else None
        if not isinstance(usage, dict):
            usage = {}
        finish = None
        try:
            choice = data["choices"][0]
            finish = choice.get("finish_reason")
            raw_content = choice["message"]["content"]
            # Some gateways return content as a list of typed parts.
            if isinstance(raw_content, list):
                raw_content = "".join(
                    p.get("text", "") for p in raw_content if isinstance(p, dict)
                )
        except (KeyError, IndexError, TypeError):
            raw_content = None
        if not raw_content:
            # A 200 with empty content still bills the whole prompt. Classic
            # cause: thinking model spent max_tokens on reasoning and had no
            # budget left for the answer (finish_reason=length).
            print(
                f"[AI] resposta 200 mas VAZIA (finish_reason={finish}, "
                f"usage={usage}, model={self.model})",
                flush=True,
            )
        return raw_content, usage

    def _post_with_retry(self, payload: dict, retries: int = 2) -> dict:
        """Post to /chat/completions, retrying only transient failures
        (429, 5xx, network). A non-429 4xx is deterministic — same request,
        same answer — so it fails on the first attempt, carrying the
        response body, which is what names the real cause (model_not_found,
        image too large, ...). Failing fast here also means the Gemini
        fallback kicks in immediately instead of after 3 wasted tries."""
        last_err: Exception | None = None
        for attempt in range(retries + 1):
            try:
                r = self.client.post(f"{self.base_url}/chat/completions", json=payload)
                if r.status_code == 429:
                    body = r.text[:300]
                    if any(m in body.lower() for m in _QUOTA_MARKERS):
                        # Daily budget gone — no sleep will bring it back.
                        raise QuotaExhaustedError(f"HTTP 429 (quota do dia): {body}")
                    last_err = RuntimeError(f"HTTP 429: {body}")
                    time.sleep(0.5 * (attempt + 1))
                    continue
                if r.status_code >= 500:
                    last_err = RuntimeError(f"HTTP {r.status_code}: {r.text[:200]}")
                    time.sleep(0.5 * (attempt + 1))
                    continue
                if r.status_code >= 400:
                    raise RuntimeError(f"HTTP {r.status_code}: {r.text[:300]}")
                return r.json()
            except httpx.HTTPError as e:
                last_err = e
                time.sleep(0.5 * (attempt + 1))
        raise RuntimeError(f"AI API error after {retries + 1} attempts: {last_err}")

    def post_content(
        self, content: list[dict], max_tokens: int = 300, retries: int = 2
    ) -> dict:
        """Build payload with THIS client's model, POST it, and if the whole
        retry loop fails AND we have a fallback, hand the same content off to
        the fallback (which rebuilds the payload with its own model). This is
        the single entry point classify_* should use — never call
        _post_with_retry directly, or the fallback won't kick in.
        """
        primary_err: Exception
        if self.dead_reason is not None:
            # Quota already known-exhausted this run: don't burn a request
            # (and 3 retry sleeps) per shot re-discovering it.
            primary_err = QuotaExhaustedError(self.dead_reason)
        else:
            payload = self._build_payload(content, max_tokens=max_tokens)
            try:
                return self._post_with_retry(payload, retries=retries)
            except QuotaExhaustedError as e:
                self.dead_reason = str(e)
                primary_err = e
            except Exception as e:
                primary_err = e

        if self.fallback is None:
            raise primary_err
        try:
            return self.fallback.post_content(
                content, max_tokens=max_tokens, retries=retries
            )
        except Exception as fallback_err:
            # When every configured provider is out of quota for the day,
            # surface that as QuotaExhaustedError so the pipeline can abort
            # the run immediately with a message that actually helps.
            if isinstance(primary_err, QuotaExhaustedError) and isinstance(
                fallback_err, QuotaExhaustedError
            ):
                raise QuotaExhaustedError(
                    f"NavyAI: {primary_err} | Gemini: {fallback_err}"
                ) from fallback_err
            raise RuntimeError(
                f"Primary AI failed ({primary_err}); "
                f"fallback also failed ({fallback_err})"
            ) from fallback_err

    @staticmethod
    def _parse_json_response(content: str) -> dict | None:
        """Parse the model's content string into a dict, being forgiving:
          - strips ``` fences
          - unwraps single-element arrays
          - handles truncated JSON (returns None)
        """
        if not content:
            return None
        s = content.strip()
        if s.startswith("```"):
            s = s.strip("`").split("\n", 1)[1] if "\n" in s else s
            s = s.rstrip("`").strip()
            if s.lower().startswith("json"):
                s = s[4:].strip()
        try:
            parsed = json.loads(s)
        except Exception:
            return None
        if isinstance(parsed, list):
            if not parsed:
                return None
            parsed = parsed[0]
        if not isinstance(parsed, dict):
            return None
        return parsed

def classify_frame(
    client: NavyAIClient,
    frame_bytes: bytes,
    character_names: list[str],
    anime_title: str,
    top_refs: dict[str, list[bytes]] | None = None,
) -> tuple[str | None, float, str | None, dict]:
    """Ask the LLM to pick one character (or 'none') from a known roster,
    given a single query frame and optional visual references for the most
    common characters.
    """
    if not character_names:
        return None, 0.0, None, {}

    preamble = [
        f'You are identifying characters from the anime "{anime_title}".',
        "",
        "Look at the query frame. Return \"none\" in ALL of these cases:",
        "• The frame shows only scenery, objects, text, UI, a hand, a weapon, food, etc.",
        "• The character's face is not visible (back view, behind object, too dark).",
        "• You can see a face but it does not clearly match any listed character.",
        "• Two characters are plausible and you can't pick one with certainty.",
        "• The character you're thinking of is not in the list below.",
        "",
        "Only pick a character if the face/hair/outfit visibly matches that specific "
        "character. Do NOT guess from props, colors, or context. When in doubt, say \"none\".",
        "",
        "Return ONLY JSON: {\"character\": \"<exact name from list or 'none'>\", "
        "\"confidence\": <0-1>, \"reason\": \"<specific visual feature>\"}.",
        "",
        "Known characters: " + ", ".join(character_names),
    ]

    content: list[dict] = [{"type": "text", "text": "\n".join(preamble)}]
    content.append({"type": "text", "text": "QUERY FRAME:"})
    content.append({"type": "image_url", "image_url": {"url": client._data_url(frame_bytes)}})

    if top_refs:
        for name, refs in top_refs.items():
            if not refs:
                continue
            content.append({"type": "text", "text": f"REFERENCE — {name}:"})
            for ref in refs[:1]:  # one ref per char to keep prompt tight
                content.append({"type": "image_url", "image_url": {"url": client._data_url(ref)}})

    # Generous cap: gemini-2.5+ are thinking models — reasoning spends from
    # the same max_tokens budget, and a tight cap yields a 200 with EMPTY
    # content (all budget burned before the JSON). Caps are ceilings, not
    # costs: we only pay for tokens actually generated.
    data = client.post_content(content, max_tokens=1536)
    raw_content, usage = client._extract_content_and_usage(data)
    if raw_content is None:
        return None, 0.0, None, usage

    parsed = client._parse_json_response(raw_content)
    if parsed is None:
        return None, 0.0, (raw_content or "")[:120], usage

    name = (parsed.get("character") or "").strip() if isinstance(parsed.get("character"), str) else ""
    try:
        conf = float(parsed.get("confidence") or 0.0)
    except (ValueError, TypeError):
        conf = 0.0
    reason = parsed.get("reason") if isinstance(parsed.get("reason"), str) else None
    if not name or name.lower() == "none":
        return None, conf, reason, usage
    return name, conf, reason, usage


def classify_face_crops(
    client: NavyAIClient,
    face_crops_bytes: list[bytes],
    character_names: list[str],
    anime_title: str,
    top_refs: dict[str, list[bytes]] | None = None,
) -> tuple[list[tuple[str, float]], dict]:
    """Hybrid mode: you already have face crops from YOLO. Send them to the
    model and ask 'for each face, which character is it?'. Returns a list of
    (name, confidence) — one per face — plus the usage dict.

    Sending tight face crops (vs the whole keyframe) is cheaper and more
    accurate: the model isn't distracted by scenery/other chars.
    """
    if not face_crops_bytes or not character_names:
        return [], {}

    preamble = [
        f'You are identifying anime characters from "{anime_title}".',
        "Each image below is a face crop detected in a single shot.",
        "For EACH face, identify which listed character it matches.",
        "",
        "DECISIVE FEATURES to look for (in order of importance):",
        "1. Hair color + hairstyle (most distinctive in anime).",
        "2. Accessories attached to the head (headband, hat, bow, goggles).",
        "3. Eye color + shape.",
        "4. Outfit/collar if visible.",
        "Similar-looking male protagonists with different hair colors are DIFFERENT characters — do not merge them.",
        "",
        "Return \"none\" for a face if ANY of these apply:",
        "• The face does not clearly match any listed character's distinctive hair/accessories.",
        "• Two characters could plausibly fit and you can't pick one.",
        "• The crop is too blurry, dark, or occluded to identify.",
        "• The character is unlisted.",
        "",
        "Do not force a match. It is better to return \"none\" than to guess.",
        "",
        "Return ONLY JSON: {\"faces\": [{\"character\": \"<name or 'none'>\", "
        "\"confidence\": <0-1>, \"reason\": \"<specific visual feature>\"}, ...]}.",
        "The faces array must have exactly " + str(len(face_crops_bytes))
        + " entries, one per input face, in the same order.",
        "",
        "Known characters: " + ", ".join(character_names),
    ]

    content: list[dict] = [{"type": "text", "text": "\n".join(preamble)}]
    for i, face in enumerate(face_crops_bytes, 1):
        content.append({"type": "text", "text": f"FACE {i}:"})
        content.append({"type": "image_url", "image_url": {"url": client._data_url(face)}})

    if top_refs:
        content.append({"type": "text", "text": "Character references:"})
        for name, refs in top_refs.items():
            if not refs:
                continue
            content.append({"type": "text", "text": f"— {name}:"})
            for ref in refs[:1]:
                content.append({"type": "image_url", "image_url": {"url": client._data_url(ref)}})

    # 2048: room for the thinking pass + one JSON entry per face (see the
    # matching comment in classify_frame).
    data = client.post_content(content, max_tokens=2048)
    raw, usage = client._extract_content_and_usage(data)
    if raw is None:
        return [], usage
    parsed = client._parse_json_response(raw)
    if not parsed:
        return [], usage

    faces = parsed.get("faces") if isinstance(parsed, dict) else None
    if not isinstance(faces, list):
        return [], usage

    out: list[tuple[str, float]] = []
    for entry in faces:
        if not isinstance(entry, dict):
            out.append(("none", 0.0))
            continue
        name = entry.get("character")
        if not isinstance(name, str) or name.lower() == "none":
            name = "none"
        try:
            conf = float(entry.get("confidence") or 0.0)
        except (ValueError, TypeError):
            conf = 0.0
        out.append((name, conf))
    return out, usage


def classify_group(
    client: NavyAIClient,
    group_crops: list[bytes],
    candidates: list[tuple[str, list[bytes]]],
    anime_title: str,
) -> tuple[str | None, float, dict]:
    """Revisão por GRUPO (contact sheet): todas as imagens da grade são o
    MESMO personagem — o modelo escolhe qual candidato corresponde, ou
    UNKNOWN. Identidade agregada é um problema mais fácil e estável que
    classificar um crop isolado: uma piscada ou um perfil não decide nada
    sozinho, e UMA resposta vale por todas as cenas do grupo.

    Retorna (nome_ou_None, confiança, usage)."""
    if not group_crops or not candidates:
        return None, 0.0, {}

    cand_names = [n for n, _ in candidates]
    preamble = [
        f'You are identifying a character from the anime "{anime_title}".',
        "",
        f"The {len(group_crops)} GROUP images below all show the SAME "
        "character (grouped automatically by visual similarity within one "
        "episode) — different angles, expressions and lighting of one person.",
        "",
        "Compare the GROUP as a whole against each candidate's reference "
        "images. Judge by hair color + hairstyle, head accessories, eye "
        "color/shape and outfit. Base the decision on the clearest group "
        "images — ignore blurry or partial ones.",
        "",
        "Return \"none\" if the group does not clearly match any candidate, "
        "or if two candidates are equally plausible. Do not force a match.",
        "",
        "Return ONLY JSON: {\"character\": \"<exact candidate name or "
        "'none'>\", \"confidence\": <0-1>, \"reason\": \"<specific visual "
        "feature>\"}.",
        "",
        "Candidates: " + ", ".join(cand_names),
    ]
    content: list[dict] = [{"type": "text", "text": "\n".join(preamble)}]
    content.append({"type": "text", "text": "GROUP (same character):"})
    for crop in group_crops:
        content.append({"type": "image_url", "image_url": {"url": client._data_url(crop)}})
    for name, refs in candidates:
        if not refs:
            continue
        content.append({"type": "text", "text": f"CANDIDATE — {name}:"})
        for ref in refs[:2]:
            content.append({"type": "image_url", "image_url": {"url": client._data_url(ref)}})

    data = client.post_content(content, max_tokens=1536)
    raw, usage = client._extract_content_and_usage(data)
    if raw is None:
        return None, 0.0, usage
    parsed = client._parse_json_response(raw)
    if not isinstance(parsed, dict):
        return None, 0.0, usage
    name = parsed.get("character")
    name = name.strip() if isinstance(name, str) else ""
    try:
        conf = float(parsed.get("confidence") or 0.0)
    except (ValueError, TypeError):
        conf = 0.0
    if not name or name.lower() in ("none", "unknown"):
        return None, conf, usage
    return name, conf, usage
