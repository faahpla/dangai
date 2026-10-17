from __future__ import annotations

import io
from pathlib import Path

import numpy as np
import open_clip
import torch
from PIL import Image


class EmbeddingEngine:
    """Wrapper around open_clip for producing L2-normalized image embeddings.

    Tries CUDA first (if `use_cuda=True` and available). Runs a sanity
    forward pass; if CUDA works but the installed PyTorch build has no
    kernel for this GPU arch (common cause of "no kernel image is
    available"), silently falls back to CPU.
    """

    def __init__(
        self,
        model_name: str = "ViT-B-32",
        pretrained: str = "openai",
        use_cuda: bool = True,
    ) -> None:
        self.on_device_fallback: str | None = None
        self.model_name = model_name
        prefer_cuda = use_cuda and torch.cuda.is_available()
        self.device = torch.device("cuda" if prefer_cuda else "cpu")

        # Os pesos "openai" do CLIP foram treinados com QuickGELU. O open_clip
        # 2.x+/3.x parou de ativar isso por padrão pra "ViT-L-14" (só o nome
        # com sufixo -quickgelu ativa), o que geraria embeddings num espaço
        # LIGEIRAMENTE diferente do das referências já cacheadas (calculadas
        # com QuickGELU) — degradando o reconhecimento. Forçamos pra manter a
        # consistência com o cache existente.
        force_quick_gelu = pretrained == "openai"
        self.model, _, self.preprocess = open_clip.create_model_and_transforms(
            model_name,
            pretrained=pretrained,
            device=self.device,
            force_quick_gelu=force_quick_gelu,
        )
        self.model.eval()

        if prefer_cuda:
            try:
                with torch.no_grad():
                    dummy = torch.zeros(1, 3, 224, 224, device=self.device)
                    out = self.model.encode_image(dummy)
                    # Force any async CUDA errors to surface now, not later.
                    torch.cuda.synchronize()
                    _ = out.detach().cpu()
            except Exception as e:
                self._fallback_to_cpu(str(e))

    @torch.no_grad()
    def embed_images(self, images: list[Image.Image | np.ndarray | Path | str]) -> np.ndarray:
        if not images:
            return np.zeros((0, self._dim()), dtype=np.float32)
        tensors = []
        for img in images:
            pil = self._to_pil(img)
            if pil is None:
                continue
            tensors.append(self.preprocess(pil))
        if not tensors:
            return np.zeros((0, self._dim()), dtype=np.float32)
        return self._forward(torch.stack(tensors))

    @torch.no_grad()
    def embed_texts(self, texts: list[str]) -> np.ndarray:
        """Frases no MESMO espaço das imagens (L2-normalizado).

        O CLIP foi treinado pra que imagem e legenda caiam perto. É o que
        permite perguntar a um recorte "você é um rosto ou uma nuca?" sem
        treinar nada — ver `face_clustering.probabilidade_de_rosto`.
        """
        if not texts:
            return np.zeros((0, self._dim()), dtype=np.float32)
        tokens = open_clip.get_tokenizer(self.model_name)(texts).to(self.device)
        feats = self.model.encode_text(tokens)
        feats = feats / feats.norm(dim=-1, keepdim=True).clamp(min=1e-8)
        return feats.detach().cpu().numpy().astype(np.float32)

    @torch.no_grad()
    def _forward(self, batch: torch.Tensor) -> np.ndarray:
        try:
            b = batch.to(self.device)
            feats = self.model.encode_image(b)
            feats = feats / feats.norm(dim=-1, keepdim=True).clamp(min=1e-8)
            arr = feats.detach().cpu().numpy().astype(np.float32)
            if self.device.type == "cuda":
                torch.cuda.synchronize()
            return arr
        except Exception as e:
            if self.device.type == "cuda":
                self._fallback_to_cpu(str(e))
                b = batch.to(self.device)
                feats = self.model.encode_image(b)
                feats = feats / feats.norm(dim=-1, keepdim=True).clamp(min=1e-8)
                return feats.detach().cpu().numpy().astype(np.float32)
            raise

    def _fallback_to_cpu(self, err: str) -> None:
        self.on_device_fallback = (
            f"GPU detectada mas incompatível com o PyTorch instalado "
            f"({err.splitlines()[0]}). Usando CPU."
        )
        print(f"[CorteCenas] {self.on_device_fallback}")
        self.device = torch.device("cpu")
        self.model = self.model.to(self.device)
        try:
            torch.cuda.empty_cache()
        except Exception:
            pass

    def embed_paths(self, paths: list[Path]) -> np.ndarray:
        return self.embed_images([p for p in paths])

    @staticmethod
    def _to_pil(item) -> Image.Image | None:
        try:
            if isinstance(item, Image.Image):
                return item.convert("RGB")
            if isinstance(item, np.ndarray):
                if item.ndim == 3 and item.shape[2] == 3:
                    # BGR from cv2 -> RGB
                    return Image.fromarray(item[:, :, ::-1])
                return Image.fromarray(item).convert("RGB")
            if isinstance(item, (str, Path)):
                return Image.open(item).convert("RGB")
        except Exception:
            return None
        return None

    def _dim(self) -> int:
        return int(self.model.visual.output_dim) if hasattr(self.model.visual, "output_dim") else 512


def to_bytes(arr: np.ndarray) -> bytes:
    buf = io.BytesIO()
    np.save(buf, arr.astype(np.float32), allow_pickle=False)
    return buf.getvalue()


def from_bytes(b: bytes) -> np.ndarray:
    if not b:
        return np.zeros((0,), dtype=np.float32)
    return np.load(io.BytesIO(b), allow_pickle=False).astype(np.float32)
