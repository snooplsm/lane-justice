import type { Metadata } from "next";
import BikeGame from "./BikeGame";

export const metadata: Metadata = {
  title: "Lane Justice — Snap. Clear. Ride.",
  description:
    "A grounded 3D urban cycling game. Document bike-lane and crosswalk violations while riding through live traffic.",
};

export default function Home() {
  return <BikeGame />;
}
