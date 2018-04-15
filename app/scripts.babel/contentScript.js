import * as _ from 'underscore'
import VanillaModal from 'vanilla-modal'
var moment = require('moment')
var soda = require('soda-js')

const loadService = URLOrigin => {
  if (URLOrigin.match(/^http(s?):\/\/(?:www\.)?trycaviar.com$/)) {
    return new CaviarService()
  } else if (URLOrigin.match(/^http(s?):\/\/(?:www\.)?postmates.com$/)) {
    return new PostmatesService()
  }
  return new UnsupportedService()
}

/**
  Map '* Risk' category strings (used for violation line-items) to a color
  @returns {string} Color Name
*/
const RiskCategoryColorClasses = {
  'Low Risk': 'green',
  'Moderate Risk': 'orange',
  'High Risk': 'red'
}

/**
  Map global restaurant operating condition strings to a color
  @returns {string} Color Name
*/
const OperatingConditionColorClasses = {
  'Good': 'green',
  'Adequate': 'yellow',
  'Needs Improvement': 'orange',
  'Poor': 'red'
}

const ScoreToOperatingConditionCategoryName = (score) => {
  switch (true) {
    case (score < 71):
      return 'Poor'
    case (score < 86):
      return 'Needs Improvement'
    case (score < 90):
      return 'Adequate'
    default:
      return 'Good'
  }
}

const retry = (callback, intervalMS = 100, maxAttempts = 100) => {
  if (callback()) {
    return callback
  }
  if (maxAttempts < 1) {
    return false
  }
  setTimeout(function () {
    retry(callback, intervalMS, maxAttempts - 1)
  }, intervalMS)
}

class DeliveryService {
  isRestaurantPage () { return false }
  getRestaurantName () { return '' }
  getContainerElement () { return false }
  isSupportedRegion () { return false }
  // When available, addresses help to disambiguate when a restaurant has multiple locations.
  getAddress () { return false }

  processResults (data) {
    // Paint badge
    paintBadgeFromResults(this, data)

    // Populate health inspection history modal
    const tableMarkup = makeInspectionTableFromResults(data)

    // Inject modal of inspection data into page
    injectInspectionData(this, tableMarkup)
  }

  processError (error) {
    retry(() => {
      let containerElement = service.getContainerElement()
      if (!containerElement) {
        return false
      }
      containerElement.insertAdjacentHTML('beforeend', '<div class="healthBadge">Error loading health data.</div>')
      return true
    })
  }

  execute () {
    if (!this.isRestaurantPage()) {
      return
    }

    healthAPI(this)
  }
}

class UnsupportedService extends DeliveryService {
  execute () {} // No-op
}

class CaviarService extends DeliveryService {
  isRestaurantPage () {
    // Caviar has a "type" meta tag with a value of restaurant.restaurant.
    let metaTag = document.querySelector('meta[property=\'og:type\']')
    return (metaTag && (metaTag.getAttribute('content') === 'restaurant.restaurant'))
  }

  getRestaurantName () {
    // Caviar has a "title" meta tag that contains the restaurant name.
    return document.querySelector('meta[property=\'og:title\']').getAttribute('content')
  }

  getContainerElement () {
    return document.getElementsByClassName('merchant_info')[0]
  }
}

class PostmatesService extends DeliveryService {
  isRestaurantPage () {
    // May be prone to breakage with Postmates changes: restaurant deliveries on Postmates have a meta tag with a certain pattern for restaurants.
    let meta = document.querySelector('meta[property=\'og:description\']')
    if (!meta) {
      return false
    }
    let matches = meta.content.match(/Order Delivery from (.*?) on (.*), San Francisco, CA./i)
    if (matches) {
      this.restaurantName = matches[1]
      this.address = matches[2]
      return true
    }
  }

  getRestaurantName () {
    return this.restaurantName
  }

  getAddress () {
    return this.address
  }

  getContainerElement () {
    // Postmates does not label their elements with intelligible class/ID names, so we have to use content/structure.
    // Find an h1 containing the restaurant name
    let headers = document.getElementsByTagName('h1')

    // At the time of making this script, there should only be 1 h1 in this set (the one we're looking for)
    for (var i = 0; i < headers.length; i++) {
      if (this.getRestaurantName() === headers[i].textContent) {
        // The container element is 3 levels up the hierarchy
        let containerEl = headers[i].parentElement.parentElement.parentElement
        return containerEl
      }
    }
  }
}

function paintBadgeFromResults (service, results) {
  // Not all records have an inspection score. The first result that does is displayed as the current health score.
  let firstScoredResult = _.find(results, function (record) {
    return record.hasOwnProperty('inspection_score')
  })

  let badge
  if (!firstScoredResult) {
    badge = '<div class="healthBadge gray"><div class="label">Health Score</div>No health score on record.</div></div>'
  } else {
    let operatingConditionCategory = ScoreToOperatingConditionCategoryName(firstScoredResult['inspection_score'])
    let operatingConditionColor = OperatingConditionColorClasses[operatingConditionCategory]
    badge = `<div class="healthBadge ${operatingConditionColor}">
      <div class="label">Health Score</div>
      <div class="score">${firstScoredResult['inspection_score']}</div>
      <div class="score-description">${operatingConditionCategory}</div>
      <div class="deets-button"><a href="#modal-1" data-modal-open>View Details</a></div>
    </div>`
  }

  retry(() => {
    let containerElement = service.getContainerElement()
    if (!containerElement) {
      return false
    }
    containerElement.insertAdjacentHTML('beforeend', badge)
    return true
  })
}

function makeInspectionTableFromResults (results) {
  return `
  <table class="healthRecordsTable">
      <tr>
        <th>Date</th>
        <th>Inspection Type</th>
        <th>Risk Category</th>
        <th>Description</th>
        <th>Score</th>
      </tr>
      ${results.map(row => `<tr>
        <td>${moment(row.inspection_date).format('MMM Do YYYY')}</td>
        <td>${row.inspection_type}</td>
        <td class="${RiskCategoryColorClasses[row.risk_category]}">${row.risk_category ? row.risk_category : ''}</td>
        <td class="hbleft">${row.violation_description ? row.violation_description : ''}</td>
        <td>${row.inspection_score ? row.inspection_score : ''}</td>
      </tr>`).join('')}
    </table>
  `
}

function injectInspectionData (service, tableMarkup) {
  document.body.insertAdjacentHTML('beforeend', `<div class="healthScoreModal">
      <div class="modal-inner">
        <div class="modal-content"></div>
      </div>
    </div>`)

  document.body.insertAdjacentHTML('beforeend', `<div id="modal-1" class="modal-hider">${tableMarkup}</div>`)
  new VanillaModal({modal: '.healthScoreModal'})
}

const healthAPI = service => {
  // Socrata's API and their lib Soda can't handle SoQL with apostrophes in data. They escape them not with \, but with 2 apostrophes ('' -> '). Weird!
  let restaurantName = service.getRestaurantName().replace('\'', '\'\'')
  let api = new soda.Consumer('data.sfgov.org')
  const querySelectFields = ['business_address', 'business_id', 'business_name', 'inspection_date', 'inspection_score', 'inspection_type', 'risk_category', 'violation_description']
  api.query()
    .withDataset('sipz-fjte')
    .select(querySelectFields)
    .where({business_name: restaurantName})
    .order('inspection_date DESC')
    .getRows()
    .on('success', function (data) {
      service.processResults(data)
    })
    .on('error', function (error) {
      service.processError(error)
    })
}

const service = loadService(window.location.origin)
service.execute()
