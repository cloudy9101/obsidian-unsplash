import { requestUrl, moment } from 'obsidian'
import { ImageProvider, InsertMode, Orientation, PluginSettings } from 'SettingTab'
import { validUrl } from 'utils'

const DEFAULT_PROXY_SERVER = "https://insert-unsplash-image.cloudy9101.com/"

export interface Image {
  desc?: string
  thumb: string
  url: string
  downloadLocationUrl?: string
  author?: {
    name: string
    username: string
  }
}

export interface Fetcher {
  imageProvider: ImageProvider,
  noResult: () => boolean,
  hasPrevPage: () => boolean,
  hasNextPage: () => boolean,
  prevPage: () => void,
  nextPage: () => void,
  searchImages: (query: string) => Promise<Image[]>,
  touchDownloadLocation?: (url: string) => Promise<void>
  downloadImage: (url: string) => Promise<ArrayBuffer>,
  downloadAndInsertImage: (image: Image, createFile: (name: string, ext: string, binary: ArrayBuffer) => void) => Promise<string>,
  downloadAndGetUri: (image: Image, createFile: (name: string, ext: string, binary: ArrayBuffer) => void) => Promise<string>,
}

const pixabayOrientationMapping = {
  [Orientation.landscape]: 'horizontal',
  [Orientation.portrait]: 'vertical',
  [Orientation.squarish]: 'all',
}

const APP_NAME = encodeURIComponent("Obsidian Image Inserter Plugin")
const UTM = `utm_source=${APP_NAME}&utm_medium=referral`
const PER_PAGE = "30"

export function getFetcher(settings: PluginSettings): Fetcher {
  const startPage = 1
  let curPage = startPage
  let totalPage = 0

  const { orientation, insertMode, insertSize, imageProvider, pixabayApiKey } = settings

  if (imageProvider === ImageProvider.pixabay) {
    return {
      imageProvider,
      noResult() { return totalPage <= 0 },
      hasPrevPage() {
        return !this.noResult() && curPage > startPage
      },
      hasNextPage() {
        return !this.noResult() && curPage < totalPage
      },
      prevPage() {
        this.hasPrevPage() && (curPage -= 1)
      },
      nextPage() {
        this.hasNextPage() && (curPage += 1)
      },
      async searchImages(query: string): Promise<Image[]> {
        const url = new URL("https://pixabay.com/api/")

        url.searchParams.set("key", pixabayApiKey)
        url.searchParams.set("q", query)
        if (orientation != 'not_specified') {
          url.searchParams.set("orientation", pixabayOrientationMapping[orientation])
        }
        url.searchParams.set("page", `${curPage}`)
        url.searchParams.set("per_page", PER_PAGE)
        const res = await requestUrl({ url: url.toString() })
        const data: Pixabay.RootObject = res.json
        totalPage = data.total / parseInt(PER_PAGE)
        return data.hits.map(function(item) {
          return {
            thumb: item.previewURL,
            url: item.webformatURL,
          }
        })
      },
      async downloadImage(url: string): Promise<ArrayBuffer> {
        const res = await requestUrl({ url })
        return res.arrayBuffer
      },
      async downloadAndInsertImage(image: Image, createFile: (name: string, ext: string, binary: ArrayBuffer) => void): Promise<string> {
        const url = image.url

        // const imageSize = insertSize === "" ? (insertMode === InsertMode.remote ? "|1280" : "") : `|${insertSize}`
        const imageSize = insertSize === "" ? "" : `|${insertSize}`
        let nameText = `![img-${moment().format("YYYYMMDDHHmmss")}${imageSize}]`
        let urlText = `(${url})`

        if (insertMode === InsertMode.local) {
          const imageName = `Inserted image ${moment().format("YYYYMMDDHHmmss")}`
          const ext = "png"
          const arrayBuf = await this.downloadImage(url)
          createFile(imageName, ext, arrayBuf)
          nameText = `![[${imageName}.${ext}${imageSize}]]`
          urlText = ""
        }

        return `${nameText}${urlText}`
      },
      async downloadAndGetUri(image: Image, createFile: (name: string, ext: string, binary: ArrayBuffer) => void): Promise<string> {
        const url = image.url

        if (insertMode === InsertMode.local) {
          const imageName = `Inserted image ${moment().format("YYYYMMDDHHmmss")}`
          const ext = "png"
          const arrayBuf = await this.downloadImage(url)
          createFile(imageName, ext, arrayBuf)
          return `${imageName}.${ext}`
        }

        return url
      }
    }
  }

  let proxyServer = DEFAULT_PROXY_SERVER
  if (validUrl(settings.proxyServer)) {
    proxyServer = settings.proxyServer
  }

  return {
    imageProvider,
    noResult() { return totalPage <= 0 },
    hasPrevPage() {
      return !this.noResult() && curPage > startPage
    },
    hasNextPage() {
      return !this.noResult() && curPage < totalPage
    },
    prevPage() {
      this.hasPrevPage() && (curPage -= 1)
    },
    nextPage() {
      this.hasNextPage() && (curPage += 1)
    },
    async searchImages(query: string): Promise<Image[]> {
      const url = new URL("/search/photos", proxyServer)
      url.searchParams.set("query", query)
      if (orientation != 'not_specified') {
        url.searchParams.set("orientation", orientation)
      }
      url.searchParams.set("page", `${curPage}`)
      url.searchParams.set("per_page", PER_PAGE)
      const res = await requestUrl({ url: url.toString() })
      const data: Unsplash.RootObject = res.json
      totalPage = data.total_pages
      return data.results.map(function(item) {
        return {
          desc: item.description || item.alt_description,
          thumb: item.urls.thumb,
          url: item.urls.regular,
          downloadLocationUrl: item.links.download_location,
          author: {
            name: item.user.name,
            username: item.user.username,
          },
        }
      })
    },
    async touchDownloadLocation(url: string): Promise<void> {
      await requestUrl({ url: url.replace("https://api.unsplash.com", proxyServer) })
    },
    async downloadImage(url: string): Promise<ArrayBuffer> {
      const res = await requestUrl({ url })
      return res.arrayBuffer
    },
    async downloadAndInsertImage(image: Image, createFile: (name: string, ext: string, binary: ArrayBuffer) => void): Promise<string> {
      this.touchDownloadLocation(image.downloadLocationUrl)
      const url = image.url

      const imageSize = insertSize === "" ? "" : `|${insertSize}`
      let nameText = `![${image.desc?.slice(0, 10)}${imageSize}]`
      let urlText = `(${url})`
      const referral = `\n*Photo by [${image.author?.name}](https://unsplash.com/@${image.author?.username}?${UTM}) on [Unsplash](https://unsplash.com/?${UTM})*\n`

      if (insertMode === InsertMode.local) {
        const imageName = `Inserted image ${moment().format("YYYYMMDDHHmmss")}`
        const ext = "png"
        const arrayBuf = await this.downloadImage(url)
        createFile(imageName, ext, arrayBuf)
        nameText = `![[${imageName}.${ext}${imageSize}]]`
        urlText = ""
      }

      return `${nameText}${urlText}${referral}`
    },
    async downloadAndGetUri(image: Image, createFile: (name: string, ext: string, binary: ArrayBuffer) => void): Promise<string> {
      this.touchDownloadLocation(image.downloadLocationUrl)
      const url = image.url

      if (insertMode === InsertMode.local) {
        const imageName = `Inserted image ${moment().format("YYYYMMDDHHmmss")}`
        const ext = "png"
        const arrayBuf = await this.downloadImage(url)
        createFile(imageName, ext, arrayBuf)
        return `${imageName}.${ext}`
      }

      return url
    }
  }
}
