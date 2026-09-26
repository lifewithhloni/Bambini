/**
 * A curated, deliberately small re-export of lucide-react — the
 * project's one icon library (none existed before this phase; see
 * this phase's own report for why lucide-react specifically). Every
 * icon actually used anywhere in the app should be imported from here,
 * not directly from "lucide-react", so the whitelist stays meaningful
 * and the visual icon language doesn't drift over time.
 */
export {
  Home,
  Compass,
  PlusCircle,
  MessageCircle,
  User,
  Heart,
  Search,
  X,
  Check,
  ChevronRight,
  ChevronLeft,
  ChevronDown,
  Star,
  MapPin,
  Camera,
  ImageOff,
  Truck,
  PackageCheck,
  Loader2,
  AlertTriangle,
  Info,
  ShoppingBag,
  SlidersHorizontal,
  CreditCard,
  Banknote,
  Clock,
  // Category shortcuts (Phase 11) — matched by category slug, never a
  // database field (categories has no icon column); LayoutGrid is the
  // "All categories" fallback for anything unmatched.
  Shirt,
  Baby,
  ToyBrick,
  Milk,
  BedDouble,
  HeartHandshake,
  LayoutGrid,
} from "lucide-react";
