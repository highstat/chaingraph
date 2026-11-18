import exifr from 'exifr'
import { ImageUp } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { geoLinks } from '../../osint/geo'
import { enc, sha256Hex } from '../../osint/util'
import { useUI } from '../../store'
import { Card, CryptoPivots, KV, LinkGrid, SaveButton, ToolHeader } from './kit'

const KEY_FIELDS = [
  'Make', 'Model', 'LensModel', 'Software', 'DateTimeOriginal', 'CreateDate', 'ModifyDate', 'OffsetTimeOriginal', 'ExposureTime', 'FNumber', 'ISO',
  'FocalLength', 'FocalLengthIn35mmFormat', 'Flash', 'Orientation', 'ImageWidth', 'ImageHeight', 'ExifImageWidth', 'ExifImageHeight', 'Artist', 'Copyright',
  'BodySerialNumber', 'LensSerialNumber', 'SerialNumber', 'OwnerName', 'CameraOwnerName', 'HostComputer', 'GPSAltitude', 'GPSImgDirection', 'GPSSpeed',
  'GPSDateStamp', 'GPSTimeStamp', 'ImageDescription', 'UserComment', 'XPComment', 'XPAuthor', 'CreatorTool', 'History', 'City', 'Country', 'Headline', 'Keywords',
]

export function ImageTool() {
  const [file, setFile] = useState<File | null>(null)
  const [url, setUrl] = useState('')
  const [src, setSrc] = useState('')
  const [meta, setMeta] = useState<Record<string, any> | null>(null)
  const [hash, setHash] = useState('')
  const [quality, setQuality] = useState(0.9)
  const [scale, setScale] = useState(20)
  const ela = useRef<HTMLCanvasElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const load = async (f: File) => {
    setFile(f)
    setSrc(URL.createObjectURL(f))
    setMeta(null)
    const [m, h] = await Promise.all([
      exifr.parse(f, { tiff: true, exif: true, gps: true, xmp: true, iptc: true, icc: false, mergeOutput: true }).catch(() => null),
      f.arrayBuffer().then(sha256Hex),
    ])
    setMeta(m ?? {})
    setHash(h)
  }

  // Error Level Analysis: re-save as JPEG and amplify the per-pixel difference.
  // Edited regions often recompress differently and stand out.
  useEffect(() => {
    if (!src || !ela.current) return
    const img = new Image()
    img.onload = () => {
      const w = Math.min(img.naturalWidth, 1400)
      const h = Math.round((img.naturalHeight * w) / img.naturalWidth)
      const a = document.createElement('canvas')
      a.width = w
      a.height = h
      const ctx = a.getContext('2d')!
      ctx.drawImage(img, 0, 0, w, h)
      const orig = ctx.getImageData(0, 0, w, h)
      const re = new Image()
      re.onload = () => {
        ctx.drawImage(re, 0, 0, w, h)
        const comp = ctx.getImageData(0, 0, w, h)
        const out = ctx.createImageData(w, h)
        for (let i = 0; i < orig.data.length; i += 4) {
          for (let c = 0; c < 3; c++) out.data[i + c] = Math.min(255, Math.abs(orig.data[i + c] - comp.data[i + c]) * scale)
          out.data[i + 3] = 255
        }
        const canvas = ela.current!
        canvas.width = w
        canvas.height = h
        canvas.getContext('2d')!.putImageData(out, 0, 0)
      }
      re.src = a.toDataURL('image/jpeg', quality)
    }
    img.src = src
  }, [src, quality, scale])

  const gps = meta?.latitude != null && meta?.longitude != null ? { lat: meta.latitude as number, lng: meta.longitude as number } : null
  const rows: [string, React.ReactNode][] = meta ? KEY_FIELDS.filter((k) => meta[k] != null).map((k) => [k, meta[k] instanceof Date ? (meta[k] as Date).toISOString().replace('T', ' ').slice(0, 19) : String(Array.isArray(meta[k]) ? meta[k].join(', ') : meta[k]).slice(0, 200)]) : []
  const imgUrl = url.trim()

  return (
    <div className="tool">
      <ToolHeader title="Image forensics" desc="Local analysis (nothing is uploaded): EXIF/XMP/IPTC metadata incl. GPS position, camera serial numbers and editing software, SHA-256, error level analysis for edits, plus reverse image search by URL." />
      <div
        className="dropzone"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          const f = e.dataTransfer.files[0]
          if (f) void load(f)
        }}
      >
        <ImageUp size={22} />
        <span>{file ? file.name : 'Drop an image here or click to choose (JPEG, PNG, HEIC, TIFF, WebP)'}</span>
        <input ref={inputRef} type="file" accept="image/*,.heic,.heif" hidden onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} />
      </div>

      {file && (
        <>
          <div className="ogrid">
            <Card title="Metadata" status={rows.length ? 'ok' : 'none'} right={<SaveButton title={`Image ${file.name}`} markdown={() => `- SHA-256: ${hash}\n- GPS: ${gps ? `${gps.lat}, ${gps.lng}` : 'none'}\n${rows.map(([k, v]) => `- ${k}: ${v}`).join('\n')}`} />}>
              {rows.length ? <KV rows={[['SHA-256', <code className="small">{hash}</code>], ['Size', `${(file.size / 1024).toFixed(0)} KB · ${file.type}`], ...rows]} /> : (
                <div className="muted small">
                  No metadata. Social networks and messengers strip EXIF on upload; ask for the original file or look for other copies.
                  <div className="mt6"><code className="small">SHA-256 {hash}</code></div>
                </div>
              )}
              {meta?.Software && /photoshop|gimp|lightroom|snapseed|picsart|canva|facetune/i.test(String(meta.Software)) && <div className="callout warn">Edited with {String(meta.Software)}.</div>}
              {meta && <CryptoPivots text={JSON.stringify(meta)} />}
            </Card>
            <Card title="GPS position" status={gps ? 'ok' : 'none'}>
              {gps ? (
                <>
                  <KV rows={[['Coordinates', <code>{`${gps.lat.toFixed(6)}, ${gps.lng.toFixed(6)}`}</code>], ['Camera direction', meta?.GPSImgDirection != null ? `${Number(meta.GPSImgDirection).toFixed(0)}°` : undefined], ['Altitude', meta?.GPSAltitude != null ? `${Number(meta.GPSAltitude).toFixed(0)} m` : undefined]]} />
                  <button className="mod-cta sm mt6" onClick={() => useUI.getState().set({ osintTab: 'geo', osintSeed: `${gps.lat},${gps.lng}` })}>
                    Open in GEOINT map →
                  </button>
                </>
              ) : (
                <div className="muted small">No GPS tags. Use the GEOINT module to geolocate from visual clues.</div>
              )}
              <img src={src} alt="" className="preview" />
            </Card>
          </div>
          <Card
            title="Error level analysis"
            right={
              <span className="row gap6 small">
                quality {Math.round(quality * 100)}
                <input type="range" min={0.6} max={0.98} step={0.01} value={quality} onChange={(e) => setQuality(Number(e.target.value))} />
                gain {scale}
                <input type="range" min={5} max={60} value={scale} onChange={(e) => setScale(Number(e.target.value))} />
              </span>
            }
          >
            <canvas ref={ela} className="ela" />
            <div className="muted small mt6">Uniform noise is normal. Regions that are much brighter or darker than similar surfaces may have been pasted or retouched. Re-saved images and screenshots reduce the signal.</div>
          </Card>
          {gps && <LinkGrid groups={geoLinks(gps).slice(0, 2)} />}
        </>
      )}

      <Card title="Reverse image search (public image URL)">
        <div className="row gap6">
          <input className="text grow" placeholder="https://…/photo.jpg" value={url} onChange={(e) => setUrl(e.target.value)} />
        </div>
        <LinkGrid
          groups={[
            {
              title: imgUrl ? 'Search this image' : 'Open the engine and upload manually',
              links: [
                { label: 'Google Lens', url: imgUrl ? `https://lens.google.com/uploadbyurl?url=${enc(imgUrl)}` : 'https://lens.google.com/' },
                { label: 'Yandex Images (best for faces & places)', url: imgUrl ? `https://yandex.com/images/search?rpt=imageview&url=${enc(imgUrl)}` : 'https://yandex.com/images/' },
                { label: 'Bing Visual Search', url: imgUrl ? `https://www.bing.com/images/search?view=detailv2&iss=sbi&q=imgurl:${enc(imgUrl)}` : 'https://www.bing.com/visualsearch' },
                { label: 'TinEye (oldest copy)', url: imgUrl ? `https://tineye.com/search?url=${enc(imgUrl)}` : 'https://tineye.com/' },
                { label: 'Baidu Images', url: imgUrl ? `https://graph.baidu.com/details?isfromtusoupc=1&tn=pc&carousel=0&promotion_name=pc_image_shituindex&extUiData%5bisLogoShow%5d=1&image=${enc(imgUrl)}` : 'https://image.baidu.com/' },
                { label: 'FotoForensics', url: 'https://fotoforensics.com/' },
                { label: 'Forensically', url: 'https://29a.ch/photo-forensics/' },
                { label: 'InVID (video frames)', url: 'https://www.invid-project.eu/tools-and-services/invid-verification-plugin/' },
              ],
            },
          ]}
        />
      </Card>
    </div>
  )
}
