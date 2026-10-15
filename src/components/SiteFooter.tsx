import type { SiteSetting } from '@/payload-types'

export function SiteFooter({ settings }: { settings: SiteSetting }) {
  const year = new Date().getFullYear()
  return (
    <footer className="border-t border-ivory/10 bg-charcoal">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-10 text-sm text-mist sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <p>
          © {year} {settings.companyName}. All rights reserved.
        </p>
        {settings.socialLinks && settings.socialLinks.length > 0 && (
          <ul className="flex flex-wrap gap-5">
            {settings.socialLinks.map((link) => (
              <li key={link.id ?? link.url}>
                <a
                  href={link.url}
                  rel="noopener noreferrer"
                  target="_blank"
                  className="capitalize transition-colors hover:text-gold"
                >
                  {link.platform}
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </footer>
  )
}
