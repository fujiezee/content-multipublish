"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

export type ConfirmOptions = {
  title: string;
  detail?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};

type ConfirmRequest = ConfirmOptions & {
  resolve: (ok: boolean) => void;
};

type ConfirmFn = (options: ConfirmOptions | string) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

function normalize(options: ConfirmOptions | string): ConfirmOptions {
  if (typeof options === "string") return { title: options, danger: true };
  return { danger: true, ...options };
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);

  const confirm = useCallback<ConfirmFn>((options) => {
    return new Promise<boolean>((resolve) => {
      setRequest((prev) => {
        prev?.resolve(false);
        return { ...normalize(options), resolve };
      });
    });
  }, []);

  const close = useCallback((ok: boolean) => {
    setRequest((prev) => {
      prev?.resolve(ok);
      return null;
    });
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {request ? (
        <ConfirmLayer request={request} onClose={close} />
      ) : null}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const confirm = useContext(ConfirmContext);
  return (
    confirm ??
    ((options) => {
      const spec = normalize(options);
      return Promise.resolve(window.confirm(spec.title));
    })
  );
}

function ConfirmLayer({
  request,
  onClose,
}: {
  request: ConfirmRequest;
  onClose: (ok: boolean) => void;
}) {
  const titleId = useId();
  const detailId = useId();
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmLabel = request.confirmLabel || (request.danger ? "删掉" : "确定");
  const cancelLabel = request.cancelLabel || "先留着";

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    cancelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div className="confirm-layer" role="presentation">
      <button
        type="button"
        className="confirm-layer__back"
        aria-label="关闭"
        onClick={() => onClose(false)}
      />
      <div
        className={`confirm-layer__card card${request.danger ? " confirm-layer__card--danger" : ""}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={request.detail ? detailId : undefined}
      >
        <div className="confirm-layer__head">
          <div
            className={`confirm-layer__mark${request.danger ? " confirm-layer__mark--danger" : ""}`}
            aria-hidden
          >
            {request.danger ? "!" : "?"}
          </div>
          <div className="confirm-layer__copy">
            <h2 id={titleId}>{request.title}</h2>
            {request.detail ? (
              <p id={detailId} className="confirm-layer__detail">
                {request.detail}
              </p>
            ) : null}
          </div>
        </div>
        <div className="confirm-layer__actions">
          <button
            ref={cancelRef}
            type="button"
            className="btn btn-ghost"
            onClick={() => onClose(false)}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={request.danger ? "btn btn-danger" : "btn btn-primary"}
            onClick={() => onClose(true)}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
