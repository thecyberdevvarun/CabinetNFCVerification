import { useState } from "react";
import { ArrowRight, Factory, Snowflake } from "lucide-react";
import WorkstationPage from "./pages/WorkstationPage";

export default function App() {
  const [workstation, setWorkstation] = useState(null);
  if (workstation)
    return (
      <WorkstationPage
        freezerType={workstation}
        onBack={() => setWorkstation(null)}
      />
    );
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 p-5">
      <section className="w-full max-w-3xl rounded-3xl bg-white p-7 shadow-sm md:p-10">
        <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-blue-700 text-white">
          <Factory size={32} />
        </div>
        <p className="text-center text-sm font-bold uppercase tracking-[0.2em] text-blue-700">
          Production floor
        </p>
        <h1 className="mt-2 text-center text-2xl font-extrabold text-slate-900 md:text-3xl">
          Cabinet Validation System
        </h1>
        <p className="mt-3 text-center text-slate-500">
          Select the workstation to begin scanning.
        </p>
        <div className="mt-8 grid gap-4 md:grid-cols-2">
          {[
            {
              id: "FREEZER_PRE",
              name: "Freezer Pre",
              desc: "Pre-freezer production workstation",
            },
            {
              id: "FREEZER_POST",
              name: "Freezer Post",
              desc: "Post-freezer production workstation",
            },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => setWorkstation(item.id)}
              className="group rounded-2xl border-2 border-slate-200 p-6 text-left transition hover:border-blue-600 hover:bg-blue-50"
            >
              <div className="flex items-center justify-between">
                <div className="rounded-xl bg-sky-100 p-3 text-blue-700">
                  <Snowflake size={27} />
                </div>
                <ArrowRight className="text-slate-400 transition group-hover:translate-x-1 group-hover:text-blue-700" />
              </div>
              <h2 className="mt-5 text-xl font-bold text-slate-900">
                {item.name}
              </h2>
              <p className="mt-1 text-sm text-slate-500">{item.desc}</p>
              <span className="mt-5 inline-flex rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                Open workstation
              </span>
            </button>
          ))}
        </div>
        <p className="mt-8 text-center text-xs text-slate-400">
          Fixed workstation selection · No login or signup
        </p>
        {window.AndroidNfc && (
          <button
            onClick={() => window.AndroidNfc.changeServer()}
            className="mx-auto mt-3 block text-xs font-semibold text-blue-700 underline"
          >
            Database Settings
          </button>
        )}
      </section>
    </main>
  );
}
