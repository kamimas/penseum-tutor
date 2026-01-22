"use client";

import { LayoutGrid, Compass, Settings, ChevronDown, ChevronUp } from "lucide-react";

export function LeftNavigation() {
  return (
    <div
      style={{
        position: "fixed",
        top: 20,
        left: 20,
        bottom: 20,
        width: 210,
        background: "white",
        borderRadius: 20,
        boxShadow: "0 4px 24px rgba(0,0,0,0.06)",
        border: "1px solid #E8E4DE",
        zIndex: 100,
        display: "flex",
        flexDirection: "column",
        fontFamily: "system-ui, -apple-system, sans-serif",
        overflow: "hidden",
      }}
    >
      {/* Logo Section */}
      <div
        style={{
          padding: "24px 20px 20px",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <img
          src="/penseum_logo.svg"
          alt="Penseum"
          style={{ width: 28, height: 28 }}
        />
        <span style={{ fontWeight: 600, fontSize: 18, color: "#1a1a1a" }}>
          Penseum
        </span>
      </div>

      {/* New Course Button */}
      <div style={{ padding: "0 14px", marginBottom: 20 }}>
        <button
          style={{
            width: "100%",
            padding: "11px 16px",
            background: "#6f47eb",
            color: "white",
            border: "none",
            borderRadius: 50,
            fontSize: 14,
            fontWeight: 500,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 18, fontWeight: 400 }}>+</span>
            New Course
          </span>
          <ChevronDown size={16} strokeWidth={2.5} />
        </button>
      </div>

      {/* Navigation Items */}
      <nav style={{ padding: "0 10px", flex: 1 }}>
        {/* Dashboard - Active */}
        <NavItem icon={<LayoutGrid size={18} />} label="Dashboard" active />

        {/* Explore */}
        <NavItem icon={<Compass size={18} />} label="Explore" />

        {/* Plan & Settings */}
        <NavItem icon={<Settings size={18} />} label="Plan & Settings" />
      </nav>

      {/* User Section */}
      <div
        style={{
          padding: "16px 14px",
          borderTop: "1px solid #F0EDE8",
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginTop: "auto",
        }}
      >
        {/* Avatar */}
        <div
          style={{
            width: 38,
            height: 38,
            borderRadius: "50%",
            background: "linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "white",
            fontWeight: 600,
            fontSize: 15,
          }}
        >
          K
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: 500,
              color: "#1a1a1a",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            Kamyar Hoss...
          </div>
          <div style={{ fontSize: 12, color: "#888" }}>Pro Account</div>
        </div>

        <ChevronUp size={18} color="#999" style={{ cursor: "pointer" }} />
      </div>
    </div>
  );
}

// Navigation item component
function NavItem({
  icon,
  label,
  active = false
}: {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "11px 14px",
        borderRadius: 10,
        cursor: "pointer",
        background: active ? "#F5F3EF" : "transparent",
        color: active ? "#1a1a1a" : "#666",
        fontWeight: active ? 500 : 400,
        fontSize: 14,
        marginBottom: 4,
        transition: "background 0.15s ease",
      }}
    >
      {icon}
      {label}
    </div>
  );
}
