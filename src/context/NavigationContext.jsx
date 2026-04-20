import { createContext, useContext, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

const DirectionContext = createContext('forward');
const SetDirectionContext = createContext(() => {});

export function NavigationProvider({ children }) {
  const [direction, setDirection] = useState('forward');
  return (
    <DirectionContext.Provider value={direction}>
      <SetDirectionContext.Provider value={setDirection}>
        {children}
      </SetDirectionContext.Provider>
    </DirectionContext.Provider>
  );
}

export function useNavigationDirection() {
  return useContext(DirectionContext);
}

export function useNavigation() {
  const navigate = useNavigate();
  const setDirection = useContext(SetDirectionContext);

  const navigateForward = useCallback((to, options) => {
    setDirection('forward');
    navigate(to, options);
  }, [navigate, setDirection]);

  const navigateBack = useCallback((to, options) => {
    setDirection('back');
    if (to !== undefined) {
      navigate(to, options);
    } else {
      navigate(-1);
    }
  }, [navigate, setDirection]);

  return { navigateForward, navigateBack };
}
