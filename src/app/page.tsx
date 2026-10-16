import { redirect } from "next/navigation";

// No marketing site in this app — the firm workspace is the product surface.
export default function Home() {
  redirect("/dashboard");
}
