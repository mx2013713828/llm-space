import { createContext, useContext } from 'react';

export const WorkbenchLayoutContext = createContext(null);

export function useWorkbenchLayout() {
  const context = useContext(WorkbenchLayoutContext);

  if (!context) {
    throw new Error('useWorkbenchLayout must be used within WorkbenchLayoutContext');
  }

  return context;
}
