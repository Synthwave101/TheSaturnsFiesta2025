'use client';

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { Object3D } from "three";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";

const INVITATION_MODEL_AR_PATH = "/ar/PS2_BoxTSF25Anim.usdz";
const INVITATION_MODEL_AR_FALLBACK_PATH = "/ar/PS2_BoxTSF25Anim.usdz";
const INVITATION_MODEL_GLTF_PATH = "/ar/PS2_BoxTSF25.glb";

const buildQuickLookUrl = (basePath: string) =>
  `${basePath}#callToAction=Recoger&allowsContentScaling=1`;

// Incrementa o reduce estos valores para agrandar o encoger el GLB en pantalla por dispositivo.
const GLB_TARGET_SIZE = {
  ios: 3.12,
  default: 5.35,
} as const;

// Valores de referencia usados para calcular el zoom relativo; normalmente no es necesario modificarlos.
const GLB_BASE_TARGET_SIZE = {
  ios: 3.12,
  default: 5.35,
} as const;

// Ajusta el factor de distancia de la cámara si quieres acercar o alejar el encuadre sin cambiar la escala real del GLB.
const GLB_CAMERA_DISTANCE_FACTOR = {
  ios: 1.1,
  default: 1.04,
} as const;

// Ajustes finos de la altura de la cámara y del punto de enfoque.
const GLB_CAMERA_VERTICAL_OFFSET = {
  ios: 0.06,
  default: 0.14,
} as const;

const GLB_LOOK_AT_OFFSET_MULTIPLIER = {
  ios: 0.08,
  default: 0.08,
} as const;

// Controlan la distancia del plano cercano y lejano del frustum.
const GLB_NEAR_MULTIPLIER = {
  ios: 2.4,
  default: 2.8,
} as const;

const GLB_FAR_MULTIPLIER = {
  ios: 5.0,
  default: 6.0,
} as const;

// Control del rango de flotación; reduce el multiplier o maxRatio para limitar el movimiento vertical.
const GLB_FLOAT_RANGE = {
  ios: {
    multiplier: 0.055,
    minAmplitude: 0.05,
    maxRatio: 0.18,
  },
  default: {
    multiplier: 0.065,
    minAmplitude: 0.06,
    maxRatio: 0.2,
  },
} as const;

// Margen mínimo que se reserva por debajo del modelo para evitar recortes cuando alcanza el punto más bajo de la animación.
const GLB_BOTTOM_MARGIN_FACTOR = {
  ios: 0.04,
  default: 0.00,
} as const;

// Relación alto/ancho deseada para el lienzo interno de Three.js.
const CANVAS_INTERNAL_ASPECT = {
  ios: 0.5,
  default: 556 / 512,
} as const;

// Umbral (en px) a partir del cual consideramos que es tablet o escritorio y usamos el aspect ratio reducido.
const CANVAS_WIDE_BREAKPOINT = 820;

const FRAME_DIMENSIONS = {
  ios: {
    maxWidth: "680px",
    minHeight: "min(100dvh, 500px)",
    paddingTop: "clamp(20px, 5vh, 64px)",
    paddingBottom: "clamp(100px, 11vh, 120px)",
  },
  default: {
    maxWidth: "880px",
    minHeight: "min(70dvh, 920px)",
    paddingTop: "clamp(0px, 0vh, 0px)",
    paddingBottom: "70px",
  },
} as const;

const CONTAINER_APPEARANCE = {
  borderRadiusClass: "rounded-[28px]",
  backgroundClass: "bg-black/20",
} as const;

type InvitationSceneProps = {
  pixelFontClass?: string;
};

export function InvitationScene({ pixelFontClass }: InvitationSceneProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const quickLookRef = useRef<HTMLAnchorElement | null>(null);
  const isIOSRef = useRef(false);
  const baseYOffsetRef = useRef(0);
  const floatAmplitudeRef = useRef(0.12);
  const autoRotationRef = useRef(0);
  const manualRotationRef = useRef(0);
  const isPointerDownRef = useRef(false);
  const lastPointerXRef = useRef<number | null>(null);
  const dragPreventClickRef = useRef(false);
  const [isIOS, setIsIOS] = useState(false);
  const [quickLookUrl, setQuickLookUrl] = useState<string | null>(null);
  const quickLookUrlRef = useRef<string | null>(null);

  useEffect(() => {
    const detected = /iPad|iPhone|iPod/.test(window.navigator.userAgent);
    isIOSRef.current = detected;
    setIsIOS(detected);
  }, []);

  useEffect(() => {
    quickLookUrlRef.current = quickLookUrl;
  }, [quickLookUrl]);

  useEffect(() => {
    if (!isIOSRef.current) {
      return;
    }

    const candidatePaths = [INVITATION_MODEL_AR_PATH, INVITATION_MODEL_AR_FALLBACK_PATH];

    const resolveQuickLookUrl = async () => {
      for (const path of candidatePaths) {
        try {
          const response = await fetch(path, { method: "HEAD" });
          if (response.ok) {
            setQuickLookUrl(buildQuickLookUrl(path));
            return;
          }
        } catch (error) {
          console.warn("No se pudo verificar el asset AR", error);
        }
      }
      setQuickLookUrl(null);
    };

    void resolveQuickLookUrl();
  }, [isIOS]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return undefined;
    }

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);

    const scene = new THREE.Scene();

    const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
    camera.position.set(0, 0.6, 4);
    scene.add(camera);

    const ambientLight = new THREE.AmbientLight(0xffffff, 1.2);
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xffffff, 1);
    keyLight.position.set(4, 6, 6);
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0xffffff, 0.6);
    rimLight.position.set(-6, 4, -4);
    scene.add(rimLight);

    const clock = new THREE.Clock();
    let frameId: number;
    let model: THREE.Object3D | null = null;
    let disposed = false;

    // El tamaño de los atributos width/height del canvas (como el 512×256 del inspector) se fija aquí.
    // El tamaño de los atributos width/height del canvas (por ejemplo 512×556) se fija aquí.
  const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const width = rect.width > 0 ? rect.width : 600;
      const isWideLayout = width >= CANVAS_WIDE_BREAKPOINT;
      const aspectRatio = isIOSRef.current || isWideLayout ? CANVAS_INTERNAL_ASPECT.ios : CANVAS_INTERNAL_ASPECT.default;
      const height = width * aspectRatio;

      renderer.setSize(width, height, false);
      camera.aspect = width/ height;
      camera.updateProjectionMatrix();
    };

    resize();

    const resizeObserver =
      typeof window !== "undefined" && "ResizeObserver" in window
        ? new ResizeObserver(() => resize())
        : null;
    const observedElement = canvas.parentElement ?? canvas;
    resizeObserver?.observe(observedElement);

    const handleWindowResize = () => resize();

    if (!resizeObserver) {
      window.addEventListener("resize", handleWindowResize);
    }

    const previousTouchAction = canvas.style.touchAction;
    const previousCursor = canvas.style.cursor;
    canvas.style.touchAction = "none";
    canvas.style.cursor = "grab";

    const rotationDragFactor = 0.0056;

    const handlePointerDown = (event: PointerEvent) => {
      isPointerDownRef.current = true;
      dragPreventClickRef.current = false;
      lastPointerXRef.current = event.clientX;
      canvas.style.cursor = "grabbing";
      if (typeof canvas.setPointerCapture === "function") {
        try {
          canvas.setPointerCapture(event.pointerId);
        } catch {
          /* noop */
        }
      }
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (!isPointerDownRef.current || lastPointerXRef.current === null) {
        return;
      }

      event.preventDefault();
      const clientX = event.clientX;
      const deltaX = clientX - lastPointerXRef.current;

      if (!dragPreventClickRef.current && Math.abs(deltaX) > 2) {
        dragPreventClickRef.current = true;
      }

      manualRotationRef.current += deltaX * rotationDragFactor;
      lastPointerXRef.current = clientX;
    };

    const endPointerInteraction = (event: PointerEvent) => {
      if (canvas.hasPointerCapture?.(event.pointerId)) {
        try {
          canvas.releasePointerCapture(event.pointerId);
        } catch {
          /* noop */
        }
      }

      if (dragPreventClickRef.current) {
        event.stopPropagation();
        if (event.cancelable) {
          event.preventDefault();
        }
      }

      isPointerDownRef.current = false;
      lastPointerXRef.current = null;
      canvas.style.cursor = "grab";
    };

    canvas.addEventListener("pointerdown", handlePointerDown);
    canvas.addEventListener("pointermove", handlePointerMove);
    canvas.addEventListener("pointerup", endPointerInteraction);
    canvas.addEventListener("pointerleave", endPointerInteraction);
    canvas.addEventListener("pointercancel", endPointerInteraction);

    const handleCanvasClick = (event: MouseEvent) => {
      if (!dragPreventClickRef.current) {
        return;
      }

      dragPreventClickRef.current = false;
      event.stopPropagation();
      if (event.cancelable) {
        event.preventDefault();
      }
    };

    canvas.addEventListener("click", handleCanvasClick, true);

    (async () => {
      const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");

      const isIOSDevice = isIOSRef.current;
      const deviceKey = isIOSDevice ? "ios" : "default";
      const targetSize = isIOSDevice ? GLB_TARGET_SIZE.ios : GLB_TARGET_SIZE.default;
      const baseTargetSize = isIOSDevice ? GLB_BASE_TARGET_SIZE.ios : GLB_BASE_TARGET_SIZE.default;
      const sizeRatio = baseTargetSize > 0 ? targetSize / baseTargetSize : 1;
      const normalizedSizeRatio = Number.isFinite(sizeRatio) && sizeRatio > 0 ? sizeRatio : 1;

      if (disposed) {
        return;
      }

      const loader = new GLTFLoader();
      loader.load(
        INVITATION_MODEL_GLTF_PATH,
        (gltf: GLTF) => {
          if (disposed) {
            return;
          }

          model = gltf.scene as Object3D;
          const box = new THREE.Box3().setFromObject(model);
          const size = box.getSize(new THREE.Vector3());
          const center = box.getCenter(new THREE.Vector3());

          model.position.sub(center);

          const maxDim = Math.max(size.x, size.y, size.z) || 1;
          const scaleFactor = targetSize / maxDim;
          model.scale.multiplyScalar(scaleFactor);

          const scaledBox = new THREE.Box3().setFromObject(model);
          const scaledSize = scaledBox.getSize(new THREE.Vector3());
          const scaledHeight = scaledSize.y;
          const sphere = scaledBox.getBoundingSphere(new THREE.Sphere());
          const radius = sphere ? sphere.radius : Math.max(scaledSize.x, scaledSize.y, scaledSize.z) * 0.5;

          // Estas constantes controlan el movimiento vertical y la reserva mínima en la base del modelo.
          const floatConfig = GLB_FLOAT_RANGE[deviceKey];
          const baseAmplitude = scaledHeight * floatConfig.multiplier;
          const amplitudeWithFloor = Math.max(baseAmplitude, floatConfig.minAmplitude);
          const floatAmplitude = Math.min(amplitudeWithFloor, radius * floatConfig.maxRatio);

          // El margen inferior evita que el GLB toque el borde del canvas aun en el punto más bajo de la animación.
          const bottomMargin = scaledHeight * GLB_BOTTOM_MARGIN_FACTOR[deviceKey];
          const restingYOffset = -scaledBox.min.y + bottomMargin + floatAmplitude;
          model.position.y += restingYOffset;

          model.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) {
              const mesh = child as THREE.Mesh;
              mesh.castShadow = false;
              mesh.receiveShadow = false;
            }
          });

          // "motionRadius" define la esfera que cubre el recorrido completo del objeto para colocar la cámara.
          const motionRadius = radius + floatAmplitude;
          const fov = THREE.MathUtils.degToRad(camera.fov);
          const distance = motionRadius / Math.sin(fov / 2);
          const focusMultiplier = GLB_LOOK_AT_OFFSET_MULTIPLIER[deviceKey];
          const focusY = restingYOffset + scaledHeight * focusMultiplier;
          const distanceFactor = GLB_CAMERA_DISTANCE_FACTOR[deviceKey];
          const cameraZ = (distance * distanceFactor) / normalizedSizeRatio;
          const verticalOffset = GLB_CAMERA_VERTICAL_OFFSET[deviceKey];
          camera.position.set(0, focusY + verticalOffset, cameraZ);
          const nearMultiplier = GLB_NEAR_MULTIPLIER[deviceKey];
          const farMultiplier = GLB_FAR_MULTIPLIER[deviceKey];
          camera.near = Math.max(cameraZ - (motionRadius * nearMultiplier) / normalizedSizeRatio, 0.05);
          camera.far = cameraZ + (motionRadius * farMultiplier) / normalizedSizeRatio;
          camera.lookAt(new THREE.Vector3(0, focusY, 0));
          camera.updateProjectionMatrix();

          baseYOffsetRef.current = model.position.y;
          floatAmplitudeRef.current = floatAmplitude;
          scene.add(model);
        },
        undefined,
        (error: unknown) => {
          console.error("Failed to load GLB model", error);
        }
      );
    })();

    const animate = () => {
      frameId = window.requestAnimationFrame(animate);

      const delta = clock.getDelta();
      const elapsed = clock.elapsedTime;

      if (!isPointerDownRef.current) {
        autoRotationRef.current += delta * 0.4;
      }

      if (model) {
        model.rotation.y = autoRotationRef.current + manualRotationRef.current;
        model.position.y = baseYOffsetRef.current + Math.sin(elapsed * 1.2) * floatAmplitudeRef.current;
      }

      renderer.render(scene, camera);
    };

    animate();

    return () => {
      disposed = true;
      window.cancelAnimationFrame(frameId);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", handleWindowResize);
      renderer.dispose();
      scene.clear();
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointermove", handlePointerMove);
      canvas.removeEventListener("pointerup", endPointerInteraction);
      canvas.removeEventListener("pointerleave", endPointerInteraction);
      canvas.removeEventListener("pointercancel", endPointerInteraction);
      canvas.removeEventListener("click", handleCanvasClick, true);
      canvas.style.touchAction = previousTouchAction;
      canvas.style.cursor = previousCursor;
    };
  }, []);

  const openQuickLook = () => {
    if (!isIOSRef.current) {
      return;
    }

    const anchor = quickLookRef.current;
    if (!anchor) {
      return;
    }

    // Programmatically trigger the AR Quick Look viewer on iOS.
    const arUrl = quickLookUrlRef.current;
    if (!arUrl) {
      console.warn("No se encontró un archivo USDZ disponible para Quick Look");
      return;
    }
    anchor.href = arUrl;
    anchor.click();
    window.location.assign(arUrl);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      dragPreventClickRef.current = false;
      openQuickLook();
    }
  };

  const handleContainerClick = () => {
    if (dragPreventClickRef.current) {
      dragPreventClickRef.current = false;
      return;
    }
    openQuickLook();
  };

  const frame = isIOS ? FRAME_DIMENSIONS.ios : FRAME_DIMENSIONS.default;
  const containerMinHeight = frame.minHeight;
  const paddingTop = frame.paddingTop;
  const paddingBottom = frame.paddingBottom;
  const wrapperClass = "w-full";
  const containerClass = `relative flex h-full w-full flex-col justify-center overflow-hidden ${CONTAINER_APPEARANCE.borderRadiusClass} ${CONTAINER_APPEARANCE.backgroundClass} ${
    isIOS ? "cursor-pointer" : "cursor-default"
  }`;
  const ariaLabel = isIOS
    ? "Vista previa 3D de la invitación. Presiona para abrir en realidad aumentada."
    : "Vista previa 3D de la invitación.";

  return (
  <div className={wrapperClass} style={{ minHeight: containerMinHeight, maxWidth: frame.maxWidth }}>
      <div
        className={containerClass}
        role={isIOS ? "button" : undefined}
        tabIndex={isIOS ? 0 : -1}
        onClick={isIOS ? handleContainerClick : undefined}
        onKeyDown={isIOS ? handleKeyDown : undefined}
        aria-label={ariaLabel}
      >
        <div
          className="relative h-full w-full"
          style={{
            paddingTop,
            paddingBottom,
          }}
        >
          <canvas ref={canvasRef} className="h-full w-full" />
        </div>
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-black/35 via-transparent to-black/45" />
        {isIOS && (
          <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center px-4">
            <span
              className={`rounded-md bg-black/75 px-3 py-2 text-center text-[11px] uppercase text-white shadow-[0_6px_20px_rgba(0,0,0,0.45)] ${pixelFontClass ?? ""}`.trim()}
              style={{ letterSpacing: "0.2em" }}
            >
              Presiona para recoger tu nuevo item
            </span>
          </div>
        )}
        <a ref={quickLookRef} rel="ar" href={quickLookUrl ?? ""} className="hidden">
          Invitación AR
        </a>
      </div>
    </div>
  );
}
