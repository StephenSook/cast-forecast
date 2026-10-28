"use client";

import { gsap } from "gsap";
import { SplitText } from "gsap/SplitText";
import { CustomEase } from "gsap/CustomEase";
import { useGSAP } from "@gsap/react";

let ready = false;

/** Registers plugins once and defines the named eases (adapted from Lullabuy src/ui/motion/gsap.ts). */
export function setupGsap() {
  if (ready || typeof window === "undefined") return gsap;
  gsap.registerPlugin(SplitText, CustomEase, useGSAP);
  CustomEase.create("osmo", "0.625, 0.05, 0, 1");
  CustomEase.create("energy", "M0,0 C0.32,0.72 0,1 1,1");
  gsap.defaults({ ease: "osmo", duration: 0.6 });
  ready = true;
  return gsap;
}

export const prefersReducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export { gsap, SplitText, useGSAP };
