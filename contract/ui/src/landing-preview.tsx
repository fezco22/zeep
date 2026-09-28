import { useRef, type PointerEvent } from "react";
import { createRoot, type Root } from "react-dom/client";
import { motion, useMotionValue, useReducedMotion, useSpring } from "motion/react";

// React Bits TiltedCard, adapted from its TS-CSS component:
// https://reactbits.dev/ — Copyright David HDev, MIT + Commons Clause.
// The source image is the owner-provided ZEEP MacBook mockup.
function TiltedCard() {
  const frame = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion() ?? false;
  const rotateX = useMotionValue(0);
  const rotateY = useMotionValue(0);
  const spring = { damping: 28, stiffness: 90, mass: 1.4 };
  const springX = useSpring(rotateX, spring);
  const springY = useSpring(rotateY, spring);

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (reducedMotion || event.pointerType !== "mouse" || !frame.current) return;
    const bounds = frame.current.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width - 0.5;
    const y = (event.clientY - bounds.top) / bounds.height - 0.5;
    rotateX.set(y * -4.4);
    rotateY.set(x * 4.4);
  };

  const reset = () => {
    rotateX.set(0);
    rotateY.set(0);
  };

  return (
    <motion.div
      className="showcase-enter"
      initial={reducedMotion ? false : { opacity: 0, y: 42, rotateX: 5, scale: 0.975 }}
      whileInView={{ opacity: 1, y: 0, rotateX: 0, scale: 1 }}
      viewport={{ once: true, amount: 0.2 }}
      transition={{ type: "spring", stiffness: 62, damping: 19, mass: 0.9 }}
    >
      <motion.div
        ref={frame}
        className="tilted-card-frame"
        onPointerMove={handlePointerMove}
        onPointerLeave={reset}
        style={{ rotateX: springX, rotateY: springY }}
      >
        <img
          src={`${import.meta.env.BASE_URL}macup.png`}
          alt="ZEEP dashboard displayed on a MacBook, with balance, handle, and activity panels"
          draggable={false}
        />
      </motion.div>
    </motion.div>
  );
}

const roots = new WeakMap<HTMLElement, Root>();

export function mountLandingPreview(container: HTMLElement): void {
  if (roots.has(container)) return;
  const root = createRoot(container);
  roots.set(container, root);
  root.render(<TiltedCard />);
}
