import type { Dictionary } from '@/i18n/dictionaries'
import type { SiteSetting } from '@/payload-types'

type Props = {
  companyName: string
  socialLinks: NonNullable<SiteSetting['socialLinks']>
  dictionary: Dictionary
}

export function SiteFooter({ companyName, socialLinks, dictionary }: Props) {
  const year = new Date().getFullYear()
  return (
    <footer className="border-t border-ivory/10 bg-charcoal print:hidden">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-10 text-sm text-mist sm:flex-row sm:items-center sm:justify-between sm:px-8">
        <p>
          © {year} {companyName}. {dictionary.footer.rights}
        </p>
        {socialLinks.length > 0 && (
          <ul className="flex flex-wrap gap-5">
            {socialLinks.map((link) => (
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
