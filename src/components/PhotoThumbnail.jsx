import { useMemo, useEffect } from 'react';

export default function PhotoThumbnail({ file, alt, style }) {
  const url = useMemo(() => URL.createObjectURL(file), [file]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);
  return <img src={url} alt={alt} style={style} />;
}
