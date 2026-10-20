import Image from "next/image";

export function CompanyLogo({ className = "" }: { className?: string }) {
  return (
    <Image
      src="/brand/hiper-barao-logo.jpg"
      alt="Logo do Hiper Barão"
      width={640}
      height={225}
      priority
      className={`company-logo-image ${className}`.trim()}
    />
  );
}
