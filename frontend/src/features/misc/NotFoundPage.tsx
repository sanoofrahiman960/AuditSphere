import { Compass } from "lucide-react";
import { Link } from "react-router-dom";
import { EmptyState } from "@/components/ui/States";

export default function NotFoundPage() {
  return (
    <EmptyState
      icon={<Compass className="h-6 w-6" />}
      title="Page not found"
      description="The page you are looking for does not exist or has moved."
      action={
        <Link to="/" className="link text-sm">
          Back to dashboard
        </Link>
      }
    />
  );
}
