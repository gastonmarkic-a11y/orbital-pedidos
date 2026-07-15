import { createContext, useContext, useRef, useState, ReactNode, useCallback } from 'react'

type ToastType = '' | 'success' | 'error'
const Ctx = createContext<(msg: string, type?: ToastType) => void>(() => {})

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ msg: string; type: ToastType } | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>()

  const show = useCallback((msg: string, type: ToastType = '') => {
    setToast({ msg, type })
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setToast(null), 3000)
  }, [])

  return (
    <Ctx.Provider value={show}>
      {children}
      {toast && (
        <div
          className={`fixed bottom-20 left-1/2 -translate-x-1/2 z-[100] px-4 py-2.5 rounded-lg text-sm font-medium shadow-lg text-white ${
            toast.type === 'error' ? 'bg-red-600' : toast.type === 'success' ? 'bg-emerald-600' : 'bg-ink'
          }`}
        >
          {toast.msg}
        </div>
      )}
    </Ctx.Provider>
  )
}

export function useToast() {
  return useContext(Ctx)
}
