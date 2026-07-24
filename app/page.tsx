import type { Metadata } from "next";
import BikeGame from "./BikeGame";

export const metadata: Metadata = {
  title: "Lane Justice — Snap. Clear. Ride.",
  description:
    "A comic 3D bike-lane arcade game. Photograph lane blockers and watch civic justice clear the way.",
};

export default function Home() {
  return <BikeGame />;
}
