import Image from "next/image";
import { Press_Start_2P } from "next/font/google";
import { InvitationScene } from "./components/InvitationScene";

const pressStart = Press_Start_2P({ weight: "400", subsets: ["latin"] });

export default function Home() {
  return (
  <main className="flex min-h-[100svh] flex-col items-center justify-center gap-6 px-6 pb-[calc(8px+env(safe-area-inset-bottom))] pt-8 lg:justify-start">
      <Image
        src="/TheSaturnsFiesta2025Title.png"
        alt="The Saturn's Fiesta 2025"
        width={1200}
        height={400}
        priority
        className="h-auto w-full max-w-[640px]"
      />
      <InvitationScene pixelFontClass={pressStart.className} />
    </main>
  );
}
