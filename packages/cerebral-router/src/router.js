import {flattenConfig, getRoutesBySignal, hasChangedPath} from './utils'
import {getChangedProps} from 'cerebral/lib/utils'

export default class Router {
  constructor (controller, addressbar, mapper, options) {
    this.controller = controller
    this.addressbar = addressbar
    this.mapper = mapper
    this.options = options
    this.activeRoute = {}
    this.stateGetter = this.controller.getState.bind(this.controller)

    this.provider = {
      router: {
        getUrl: this.getUrl.bind(this),
        getPath: this.getPath.bind(this),
        getValues: this.getValues.bind(this),
        getOrigin: this.getOrigin.bind(this),
        setUrl: this.setUrl.bind(this),
        goTo: this.goTo.bind(this),
        redirect: this.redirect.bind(this),
        redirectToSignal: this.redirectToSignal.bind(this)
      }
    }

    if (!options.baseUrl && options.onlyHash) {
      // autodetect baseUrl
      options.baseUrl = addressbar.pathname
    }
    options.baseUrl = (options.baseUrl || '') + (options.onlyHash ? '#' : '')

    controller.on('initialized', () => {
      this.routesConfig = flattenConfig(options.routes)
      this.routesBySignal = getRoutesBySignal(this.routesConfig, controller)

      addressbar.on('change', this.onUrlChange.bind(this))
      controller.on('start', this.onSignalStart.bind(this))
      controller.on('flush', this.onFlush.bind(this))

      if (!options.preventAutostart) {
        this.onUrlChange()
      }
    })
  }

  getRoutablePart (url) {
    let path = url.replace(this.addressbar.origin, '')
    if (path[0] !== '/') {
      path = '/' + path
    }
    if (this.options.onlyHash && !~path.indexOf('#')) {
      // treat hash absense as root route
      path = path + '#/'
    }
    return path.indexOf(this.options.baseUrl) === 0
      ? path.replace(this.options.baseUrl, '')
      : null
  }

  onUrlChange (event) {
    const url = this.getRoutablePart(event ? event.target.value : this.addressbar.value)
    if (url === null) return

    let match, route, values
    try {
      const mapped = this.mapper.map(url, this.routesConfig) || {}
      match = mapped.match
      route = mapped.route
      values = mapped.values
    } catch (err) {
      throw new Error('Could not parse url (' + err + ').')
    }

    if (!match) {
      if (this.options.allowEscape) return

      event && event.preventDefault()
      console.warn(`Cerebral router - No route matched ${url}, navigation was prevented. Please verify url or catch unmatched routes with a "/*" route.`) // eslint-disable-line no-console
      return
    }

    event && event.preventDefault()
    const {signal, map, stateMapping, propsMapping} = match
    let payload = values
    const getters = {props: payload, state: this.stateGetter}

    if (stateMapping.length) {
      this.controller.runSignal('router.routed', [
        ({state, resolve}) => {
          stateMapping.forEach((key) => {
            state.set(resolve.path(map[key]), values[key] || null)
          })
        }
      ])
    }

    if (propsMapping.length) {
      payload = propsMapping.reduce((mappedPayload, key) => {
        mappedPayload[map[key].getPath(getters)] = values[key] || null
        return mappedPayload
      }, {})
    }

    const prevSignal = (this.routesConfig[this.activeRoute.route] || {}).signal
    if (signal && (prevSignal !== signal || getChangedProps(payload || {}, this.activeRoute.payload || {}))) {
      this.controller.getSignal(signal)(payload)
    }

    this.activeRoute = {route, payload}
  }

  onSignalStart (execution, payload) {
    const route = this.routesBySignal[execution.name]
    if (!route) return

    const {map} = this.routesConfig[route]
    const getters = {props: payload, state: this.stateGetter}

    // resolve mappings on current props and state
    const url = this.mapper.stringify(
      route,
      map
        ? Object.keys(map || {}).reduce((resolved, key) => {
          const value = map[key].getValue(getters)

          if (this.options.filterFalsy && !value) {
            return resolved
          }

          resolved[key] = value
          return resolved
        }, {})
        : payload
    )

    this.setUrl(url)

    this.activeRoute = {route, payload}
  }

  onFlush (changed) {
    const {route, payload} = this.activeRoute
    const {map, stateMapping} = this.routesConfig[route] || {}
    if (!stateMapping || !stateMapping.length) return

    const getters = {props: payload, state: this.stateGetter}
    let shouldUpdate = false

    const resolvedMap = Object.keys(map || {}).reduce((resolved, key) => {
      const path = map[key].getPath(getters)
      const value = map[key].getValue(getters)

      shouldUpdate = shouldUpdate || (stateMapping.indexOf(key) >= 0 && hasChangedPath(changed, path))

      if (!this.options.filterFalsy || value) {
        resolved[key] = value
      }

      return resolved
    }, {})

    if (shouldUpdate) {
      this.setUrl(this.mapper.stringify(route, Object.assign({}, resolvedMap)))
    }
  }

  setUrl (url) {
    this.addressbar.value = (this.options.baseUrl + url) || '/'
  }

  getUrl () {
    return this.addressbar.value
  }

  getPath () {
    return this.addressbar.value.replace(this.addressbar.origin + this.options.baseUrl, '').split('?')[0]
  }

  getValues () {
    const url = this.getRoutablePart(this.addressbar.value)
    const mapped = this.mapper.map(url, this.routesConfig) || {}

    return mapped.values
  }

  getOrigin () {
    return this.addressbar.origin
  }

  goTo (url) {
    this.addressbar.value = this.options.baseUrl + url
    this.onUrlChange()
  }

  redirect (url) {
    this.addressbar.value = {
      value: this.options.baseUrl + url,
      replace: true
    }

    this.onUrlChange()
  }

  redirectToSignal (signalName, payload) {
    const route = this.routesBySignal[signalName]
    if (!route) {
      console.warn(`redirectToSignal: signal '${signalName}' not bound to route.`)
    }
    this.controller.getSignal(signalName)(payload)
  }
}